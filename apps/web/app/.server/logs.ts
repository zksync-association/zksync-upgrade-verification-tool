import { type Address, type Hex, type Log, type PublicClient, formatLog, numberToHex } from "viem";
import { FOREVER, cached, concurrencyLimit } from "./cache";
import type { Lane } from "./chain/jsonrpc";
import { historyLaneOf, latestBlock, network, safeBlockNumber } from "./rpc";

// eth_getLogs without a database. Public RPCs cap block ranges (or refuse history), so ranges are
// split adaptively, and every range below the "safe" head is cached forever per filter. Only the
// newest ~64 blocks are fetched again on later requests. Scans on the app's own clients go
// through their history lane (chain/jsonrpc.ts), which batches chunks and adapts to rate limits.

export class LogsUnavailableError extends Error {
  constructor(
    readonly rpcMessage: string,
    readonly fromBlock: bigint,
    readonly toBlock: bigint
  ) {
    super(
      `The RPC refused eth_getLogs for blocks ${fromBlock}-${toBlock}: ${rpcMessage}. Use an RPC that serves log history (e.g. https://mainnet.gateway.tenderly.co or https://sepolia.gateway.tenderly.co).`
    );
  }
}

type Filter = { address: Address; topics: (Hex | null)[] };
type Segment = { from: bigint; to: bigint };
type FilterCache = {
  segments: Segment[];
  logs: Map<string, Log>;
  lock: Promise<unknown>;
  pendingTail: Map<string, Promise<Log[]>>;
};

/**
 * Where eth_getLogs goes: a history lane, or (any other client) the client itself behind a small
 * shared pool. `key` identifies the source for the cache and the learned span.
 */
type Source = {
  key: object;
  request: (filter: Filter, from: bigint, to: bigint) => Promise<Log[]>;
  /** Chunks of one scan that may be outstanding at once. */
  limit: () => <T>(task: () => Promise<T>) => Promise<T>;
};

const MIN_SPAN = 1_000n;
// A client without a lane: leave its transport capacity for foreground reads.
const clientPool = concurrencyLimit(2);
let caches = new WeakMap<object, Map<string, FilterCache>>();
// Largest span each source has accepted so far; starts unbounded and only shrinks.
let learnedSpan = new WeakMap<object, bigint>();

/**
 * Starts `lane`'s scans at `span` blocks: a cap the provider named elsewhere (the log index), so
 * the first scan here does not have to find it again.
 */
export function seedLogSpan(lane: Lane, span: bigint) {
  const learned = learnedSpan.get(lane);
  if (span > 0n && (learned === undefined || span < learned)) learnedSpan.set(lane, span);
}

async function sourceOf(client: PublicClient): Promise<Source> {
  const lane = await historyLaneOf(client);
  if (lane) {
    return {
      key: lane,
      request: (filter, from, to) => laneRequest(lane, filter, from, to),
      // The lane queues and batches; keep about as many chunks out as it can send at once, so a
      // failed scan stops early.
      limit: () => {
        const { batch, inFlightLimit } = lane.stats();
        return concurrencyLimit(Math.max(1, batch * inFlightLimit));
      },
    };
  }
  return {
    key: client,
    request: (filter, from, to) => request(client, filter, from, to),
    limit: () => clientPool,
  };
}

export async function getLogs(
  client: PublicClient,
  filter: Filter,
  fromBlock: bigint,
  toBlock?: bigint,
  { safeHead }: { safeHead?: bigint } = {}
): Promise<Log[]> {
  const head = toBlock ?? (await latestBlock()).number;
  const finalized = safeHead ?? (await safeBlockNumber());
  if (head < fromBlock) return [];
  const source = await sourceOf(client);

  const key = `${filter.address.toLowerCase()}:${filter.topics.join(",")}`;
  let byFilter = caches.get(source.key);
  if (!byFilter) {
    byFilter = new Map();
    caches.set(source.key, byFilter);
  }
  let entry = byFilter.get(key);
  if (!entry) {
    entry = { segments: [], logs: new Map(), lock: Promise.resolve(), pendingTail: new Map() };
    byFilter.set(key, entry);
  }

  const cacheTo = head < finalized ? head : finalized;
  // Unfinalized logs this call already read together with the newest finalized gap.
  const read: { tail: Log[] | null } = { tail: null };
  if (cacheTo >= fromBlock) {
    const cacheEntry = entry;
    // One fill at a time per filter, so concurrent pages don't fetch the same range twice.
    const fill = cacheEntry.lock.then(async () => {
      const gaps = missing(cacheEntry.segments, { from: fromBlock, to: cacheTo });
      for (const gap of gaps) {
        // The newest gap ends at the boundary and the tail starts right after it: one range
        // [gap.from, head] instead of two round trips.
        const joined = head > finalized && gap.to === cacheTo;
        const logs = await fetchRange(source, filter, gap.from, joined ? head : gap.to);
        for (const log of logs) {
          if (log.blockNumber !== null && log.blockNumber <= gap.to)
            cacheEntry.logs.set(logKey(log), log);
        }
        if (joined)
          read.tail = logs.filter((log) => log.blockNumber !== null && log.blockNumber > gap.to);
        cacheEntry.segments = merge([...cacheEntry.segments, gap]);
      }
    });
    cacheEntry.lock = fill.catch(() => {});
    await fill;
  }

  let fresh: Log[] = read.tail ?? [];
  if (head > finalized && read.tail === null) {
    const tailFrom = fromBlock > finalized ? fromBlock : finalized + 1n;
    const tailKey = `${tailFrom}:${head}`;
    let pending = entry.pendingTail.get(tailKey);
    if (!pending) {
      pending = fetchRange(source, filter, tailFrom, head);
      entry.pendingTail.set(tailKey, pending);
      const pendingTail = entry.pendingTail;
      const remove = () => pendingTail.delete(tailKey);
      pending.then(remove, remove);
    }
    fresh = await pending;
  }

  const all = [...entry.logs.values()].filter(
    (log) => log.blockNumber !== null && log.blockNumber >= fromBlock && log.blockNumber <= cacheTo
  );
  return [...all, ...fresh].sort(compareLogs);
}

async function fetchRange(
  source: Source,
  filter: Filter,
  from: bigint,
  to: bigint
): Promise<Log[]> {
  // Probe with the first chunk, halving until the RPC accepts it, so failures stay sequential
  // (log2 of the overshoot) instead of fanning out across parallel chunks.
  let span = learnedSpan.get(source.key) ?? to - from + 1n;
  let first: Log[];
  for (;;) {
    const end = from + span - 1n < to ? from + span - 1n : to;
    try {
      first = await source.request(filter, from, end);
      break;
    } catch (error) {
      if (!isRangeError(error) || end - from + 1n <= MIN_SPAN)
        throw new LogsUnavailableError(rpcMessage(error), from, end);
      const explicitLimit = rpcMessage(error).match(
        /range\s+\d+\s+exceeds limit of\s+([\d,]+)/i
      )?.[1];
      const cap = explicitLimit ? BigInt(explicitLimit.replaceAll(",", "")) : 0n;
      span = cap > 0n && cap < end - from + 1n ? cap : (end - from + 1n) / 2n;
      const learned = learnedSpan.get(source.key);
      if (learned === undefined || span < learned) learnedSpan.set(source.key, span);
    }
  }
  // The rest at the span that worked; a chunk that still fails (e.g. too many results) re-probes.
  const limit = source.limit();
  const rest: Promise<Log[]>[] = [];
  let failure: unknown;
  for (let start = from + span; start <= to; start += span) {
    const end = start + span - 1n < to ? start + span - 1n : to;
    rest.push(
      limit(() => {
        if (failure) return Promise.reject(failure);
        return source.request(filter, start, end);
      }).catch((error) => {
        if (failure) throw failure;
        if (!isRangeError(error)) {
          failure = new LogsUnavailableError(rpcMessage(error), start, end);
          throw failure;
        }
        return fetchRange(source, filter, start, end).catch((error) => {
          failure = error;
          throw error;
        });
      })
    );
  }
  return [first, ...(await Promise.all(rest))].flat();
}

function isRangeError(error: unknown) {
  return /block.*range|range.*(?:block|exceed|limit|too large)|query.*(?:too large|exceed)|too many (?:logs|results)|more than.*results|response.*(?:size|too large)|log.*limit/i.test(
    rpcMessage(error)
  );
}

/** One eth_getLogs on a lane. The lane already backs off on rate limits and retries timeouts. */
async function laneRequest(lane: Lane, filter: Filter, from: bigint, to: bigint) {
  const raw = await lane.request<unknown>("eth_getLogs", [
    {
      address: filter.address,
      topics: filter.topics,
      fromBlock: numberToHex(from),
      toBlock: numberToHex(to),
    },
  ]);
  if (!Array.isArray(raw)) throw new Error("eth_getLogs did not answer with a list");
  return (raw as Parameters<typeof formatLog>[0][]).map((log) => formatLog(log) as Log);
}

async function request(client: PublicClient, filter: Filter, from: bigint, to: bigint) {
  for (let attempt = 0; ; attempt++) {
    try {
      const raw = await client.request({
        method: "eth_getLogs",
        params: [
          {
            address: filter.address,
            topics: filter.topics,
            fromBlock: numberToHex(from),
            toBlock: numberToHex(to),
          },
        ],
      });
      return (raw as Parameters<typeof formatLog>[0][]).map((log) => formatLog(log) as Log);
    } catch (error) {
      // Rate limiting is not a range problem: back off instead of splitting into more requests.
      if ((error as { status?: number }).status === 429 && attempt < 3) {
        await new Promise((r) => setTimeout(r, 1_000 * (attempt + 1)));
        continue;
      }
      throw error;
    }
  }
}

function missing(segments: Segment[], want: Segment): Segment[] {
  const gaps: Segment[] = [];
  let cursor = want.from;
  for (const s of segments) {
    if (s.to < cursor) continue;
    if (s.from > want.to) break;
    if (s.from > cursor) gaps.push({ from: cursor, to: s.from - 1n });
    cursor = s.to + 1n;
    if (cursor > want.to) return gaps;
  }
  if (cursor <= want.to) gaps.push({ from: cursor, to: want.to });
  return gaps;
}

export function merge(segments: Segment[]): Segment[] {
  const sorted = [...segments].sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
  const out: Segment[] = [];
  for (const s of sorted) {
    const last = out.at(-1);
    if (last && s.from <= last.to + 1n) {
      if (s.to > last.to) last.to = s.to;
    } else {
      out.push({ ...s });
    }
  }
  return out;
}

const logKey = (log: Log) => `${log.blockNumber}:${log.logIndex}`;

function compareLogs(a: Log, b: Log) {
  const byBlock = Number((a.blockNumber ?? 0n) - (b.blockNumber ?? 0n));
  return byBlock !== 0 ? byBlock : (a.logIndex ?? 0) - (b.logIndex ?? 0);
}

function rpcMessage(error: unknown): string {
  if (error && typeof error === "object") {
    const e = error as { details?: string; shortMessage?: string; message?: string };
    return e.details || e.shortMessage || e.message || String(error);
  }
  return String(error);
}

export type LogHistoryStatus =
  | { status: "ok" }
  | { status: "unchecked" }
  | { status: "missing"; blockNumber: string }
  | { status: "error"; message: string };

/**
 * Asks the RPC for a log that must exist (the handler's own deployment event). Some RPCs return
 * an empty array for old blocks instead of an error; without this check an incomplete list would
 * look exactly like a quiet governance week.
 */
export function checkLogHistory(client: PublicClient): Promise<LogHistoryStatus> {
  return cached("log-canary", 10 * 60_000, async () => {
    const { logCanary } = await network();
    if (!logCanary) return { status: "unchecked" } as const;
    try {
      const logs = await request(
        client,
        { address: logCanary.address, topics: [logCanary.topic0] },
        logCanary.blockNumber,
        logCanary.blockNumber
      );
      return logs.length > 0
        ? ({ status: "ok" } as const)
        : ({ status: "missing", blockNumber: logCanary.blockNumber.toString() } as const);
    } catch (error) {
      return { status: "error", message: rpcMessage(error) } as const;
    }
  });
}

/**
 * First block in [low, high] whose timestamp is >= `timestamp`. Interpolation search over block
 * headers (timestamps are close to linear in block number, so it usually takes 3-5 headers),
 * falling back to bisection whenever a guess does not halve the range. Works on RPCs without
 * archive state or log history.
 */
export async function findBlockByTimestamp(
  client: PublicClient,
  timestamp: bigint,
  low: bigint,
  high: bigint,
  // Header timestamps below the safe head never change; pass null on dev nodes, where they do.
  cache: { key: string; safeHead: bigint } | null
) {
  const fetchTime = (n: bigint) => client.getBlock({ blockNumber: n }).then((b) => b.timestamp);
  const headerTime = (n: bigint) =>
    cache && n <= cache.safeHead
      ? cached(`block-ts:${cache.key}:${n}`, FOREVER, () => fetchTime(n))
      : fetchTime(n);

  let lo = low;
  let hi = high;
  let tLo = await headerTime(lo);
  if (tLo >= timestamp) return lo;
  let tHi = await headerTime(hi);
  if (tHi < timestamp) return hi;
  // Invariant: time(lo) < timestamp <= time(hi).
  let bisect = false;
  while (hi - lo > 1n) {
    let mid =
      bisect || tHi === tLo ? (lo + hi) / 2n : lo + ((timestamp - tLo) * (hi - lo)) / (tHi - tLo);
    if (mid <= lo) mid = lo + 1n;
    if (mid >= hi) mid = hi - 1n;
    const before = hi - lo;
    const tMid = await headerTime(mid);
    if (tMid < timestamp) {
      lo = mid;
      tLo = tMid;
    } else {
      hi = mid;
      tHi = tMid;
    }
    bisect = (hi - lo) * 2n > before;
  }
  return hi;
}

export function resetLogCaches() {
  caches = new WeakMap();
  learnedSpan = new WeakMap();
}
