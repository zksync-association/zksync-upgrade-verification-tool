import { type Address, type Hex, type Log, type PublicClient, formatLog, numberToHex } from "viem";
import { FOREVER, cached } from "./cache";
import { latestBlock, network, safeBlockNumber } from "./rpc";

// eth_getLogs without a database. Public RPCs cap block ranges (or refuse history), so ranges are
// split adaptively, and every range below the "safe" head is cached forever per filter. Only the
// newest ~64 blocks are fetched again on later requests.

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
type FilterCache = { segments: Segment[]; logs: Map<string, Log>; lock: Promise<unknown> };

const MIN_SPAN = 1_000n;
const caches = new WeakMap<PublicClient, Map<string, FilterCache>>();
// Largest span each client has accepted so far; starts unbounded and only shrinks.
const learnedSpan = new WeakMap<PublicClient, bigint>();

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

  const key = `${filter.address.toLowerCase()}:${filter.topics.join(",")}`;
  let byFilter = caches.get(client);
  if (!byFilter) {
    byFilter = new Map();
    caches.set(client, byFilter);
  }
  let entry = byFilter.get(key);
  if (!entry) {
    entry = { segments: [], logs: new Map(), lock: Promise.resolve() };
    byFilter.set(key, entry);
  }

  const cacheTo = head < finalized ? head : finalized;
  if (cacheTo >= fromBlock) {
    const cacheEntry = entry;
    // One fill at a time per filter, so concurrent pages don't fetch the same range twice.
    const fill = cacheEntry.lock.then(async () => {
      for (const gap of missing(cacheEntry.segments, { from: fromBlock, to: cacheTo })) {
        for (const log of await fetchRange(client, filter, gap.from, gap.to)) {
          cacheEntry.logs.set(logKey(log), log);
        }
        cacheEntry.segments = merge([...cacheEntry.segments, gap]);
      }
    });
    cacheEntry.lock = fill.catch(() => {});
    await fill;
  }

  const fresh =
    head > finalized
      ? await fetchRange(client, filter, fromBlock > finalized ? fromBlock : finalized + 1n, head)
      : [];

  const all = [...entry.logs.values()].filter(
    (log) => log.blockNumber !== null && log.blockNumber >= fromBlock && log.blockNumber <= cacheTo
  );
  return [...all, ...fresh].sort(compareLogs);
}

async function fetchRange(
  client: PublicClient,
  filter: Filter,
  from: bigint,
  to: bigint
): Promise<Log[]> {
  // Probe with the first chunk, halving until the RPC accepts it, so failures stay sequential
  // (log2 of the overshoot) instead of fanning out across parallel chunks.
  let span = learnedSpan.get(client) ?? to - from + 1n;
  let first: Log[];
  for (;;) {
    const end = from + span - 1n < to ? from + span - 1n : to;
    try {
      first = await request(client, filter, from, end);
      break;
    } catch (error) {
      if (end - from + 1n <= MIN_SPAN) throw new LogsUnavailableError(rpcMessage(error), from, end);
      span = (end - from + 1n) / 2n;
      const learned = learnedSpan.get(client);
      if (learned === undefined || span < learned) learnedSpan.set(client, span);
    }
  }
  // The rest at the span that worked; a chunk that still fails (e.g. too many results) re-probes.
  const rest: Promise<Log[]>[] = [];
  for (let start = from + span; start <= to; start += span) {
    const end = start + span - 1n < to ? start + span - 1n : to;
    rest.push(
      request(client, filter, start, end).catch(() => fetchRange(client, filter, start, end))
    );
  }
  return [first, ...(await Promise.all(rest))].flat();
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
