import { defaultLogger } from "@config/log.server";
import { type Address, type Hex, type Log, formatLog, numberToHex } from "viem";
import { LogsUnavailableError } from "../logs";
import { type Lane, RpcError } from "./jsonrpc";
import { asRequestWork } from "../sync/pacer";

// Every log one contract (or a few) has emitted since deployment, in memory. The filter is the
// address alone (a topic OR-list would drop events the ABI does not list, a proxy's Upgraded),
// unless an index names the topic0 values it keeps (the L2 governors' index skips their votes).
// Coverage is one contiguous range of final blocks plus a tail (finalizedTo, head] read again for
// every new head. The backfill fills the final range downward, newest first; a query waits
// (bounded) until its range is covered and never answers with a partial list.

/** The head a query is answered at, and the finality boundary F: blocks <= F never change. */
export type IndexHead = { head: { number: bigint; hash: Hex }; safe: bigint };

/** A log the index accepted: mined, from the indexed address, inside the range it was read for. */
export type IndexedLog = Log<bigint, number, false>;

/**
 * A query's answer: logs at or below `finalTo` come from the final range and never change; above
 * it, from this head's tail. Logs at or below `provisionalTo` are from the last run's history, not
 * read again yet (pages only; never kept); null when every log was read in this run.
 */
export type IndexRead = { logs: IndexedLog[]; finalTo: bigint; provisionalTo: bigint | null };

type IndexState = "idle" | "backfilling" | "ready" | "unavailable";

/** A previous run's history (from disk): untrusted until this run's backfill reads that range. */
export type ProvisionalSeed = { finalizedTo: bigint; logs: IndexedLog[] };

export type ProvisionalOutcome = "verified" | "mismatch" | "dropped";

type ProvisionalStatus = {
  state: "provisional" | "verified" | "mismatch";
  finalizedTo: string;
  logs: number;
};

export type FinalSnapshot = {
  coveredFrom: bigint;
  finalizedTo: bigint;
  logs: readonly IndexedLog[];
};

export type IndexStatus = {
  state: IndexState;
  deployBlock: string;
  coveredFrom: string | null;
  finalizedTo: string | null;
  headTo: string | null;
  chunks: { done: number; total: number };
  strategy: "full-range" | "chunked" | null;
  span: string | null;
  logs: number;
  error: string | null;
  provisional: ProvisionalStatus | null;
};

export type LogQuery = {
  fromBlock?: bigint;
  toBlock?: bigint;
  waitMs?: number;
  signal?: AbortSignal;
  head?: IndexHead;
  /** Pages only, never JSON: may answer from the last run's history, not yet verified. */
  provisional?: boolean;
};

export type LogIndexOptions = {
  label: string;
  lane: Lane;
  quickLane?: Lane;
  address: Address | readonly Address[];
  topic0?: readonly Hex[];
  deployBlock: bigint;
  head: () => Promise<IndexHead>;
  /** False once the settings this index was built for changed: nothing more is inserted. */
  isCurrent?: () => boolean;
  /** Error text for status and logs. Must not reveal RPC URLs. */
  describeError?: (error: unknown) => string;
  waitMs?: number;
  hedgeMs?: number;
  minSpan?: bigint;
  chunkRetries?: number;
  retryDelayMs?: number;
  retryMs?: number;
  onCap?: (cap: bigint) => void;
};

export interface LogIndex {
  /** Starts or resumes the backfill; never rejects. A run outlives the request that started it. */
  startBackfill(): Promise<void>;
  status(): IndexStatus;
  finalRange(): { from: bigint; to: bigint } | null;
  /** Every log in [fromBlock, toBlock], complete, ordered by (blockNumber, logIndex). */
  logs(query?: LogQuery): Promise<IndexedLog[]>;
  read(query?: LogQuery): Promise<IndexRead>;
  syncHead(head?: IndexHead): Promise<void>;
  /** Seeds a previous run's history (logs checked by parseLogs); false when it cannot be used. */
  seedProvisional(
    seed: ProvisionalSeed,
    onOutcome?: (outcome: ProvisionalOutcome) => void
  ): boolean;
  dropProvisional(): void;
  finalSnapshot(): FinalSnapshot | null;
  close(): void;
}

/** A seed from the last run may still come (the chain cache is loading): pages wait, bounded. */
export class SeedExpectation {
  #pending: Promise<void> | null = null;

  expect(until: Promise<unknown>) {
    const settled = until.then(
      () => {},
      () => {}
    );
    this.#pending = settled;
    void settled.then(() => {
      if (this.#pending === settled) this.#pending = null;
    });
  }

  get pending(): boolean {
    return this.#pending !== null;
  }

  wait(ms = SEED_WAIT_MS): Promise<void> {
    const pending = this.#pending;
    if (!pending) return Promise.resolve();
    let timer: ReturnType<typeof setTimeout> | undefined;
    return Promise.race([
      pending,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, ms);
        (timer as { unref?: () => void }).unref?.();
      }),
    ]).finally(() => clearTimeout(timer));
  }
}

const SEED_WAIT_MS = 2_000;

export class IndexIncomplete extends Error {
  override name = "IndexIncomplete";
  constructor(
    readonly label: string,
    readonly needFrom: bigint,
    readonly coveredFrom: bigint | null
  ) {
    super(
      `The ${label} log index does not cover block ${needFrom} yet (${
        coveredFrom === null ? "nothing indexed yet" : `indexed down to block ${coveredFrom}`
      }). Try again in a moment.`
    );
  }
}

export class IndexUnavailable extends LogsUnavailableError {
  override name = "IndexUnavailable";
}

export class IndexClosed extends Error {
  override name = "IndexClosed";
  constructor(label: string) {
    super(`The data source changed while the ${label} log index was read. Try again.`);
  }
}

/** An eth_getLogs answer that cannot be trusted as the complete list for its range. */
export class InvalidLogsAnswer extends Error {
  override name = "InvalidLogsAnswer";
}

type Range = { from: bigint; to: bigint };
type Chunk = Range & { attempts: number; lastFailure?: { landings: number; failures: number } };
type Landed = Range & { logs: IndexedLog[] };
type Failure = { message: string; error: unknown; from: bigint; to: bigint; at: number };
type Tail = { head: { number: bigint; hash: Hex }; logs: IndexedLog[] };

/** Below this many blocks per eth_getLogs, a history backfill is hopeless (logs.ts MIN_SPAN). */
const MIN_SPAN = 1_000n;
// The bridge above a seeded history is read on its own only up to this many spans (10,000 blocks
// while none is known: Infura's cap); a wider gap is left to the newest-first backfill.
const BRIDGE_MAX_CHUNKS = 8n;
const BRIDGE_DEFAULT_SPAN = 10_000n;
const LATENCY_SAMPLES = 64;
// Other chunks failing, with none landing, between two failures of one chunk: a provider-wide
// burst, not a range too dense to answer.
const BURST_FAILURES = 16;

// How nodes say an eth_getLogs range is too big: Infura "range 10001 exceeds limit of 10000",
// "query returned more than 10000 results", Alchemy "Log response size exceeded", QuickNode
// "eth_getLogs is limited to a 10,000 range", "block range too large", ...
const RANGE_ERROR =
  /block range|\brange\b.*\b(?:exceed|limit|too (?:large|wide|big))|exceed\w*\b.*\brange\b|range.*(?:block|exceed|limit|too large)|more than [\d,]+ (?:results|logs)|max(?:imum)? (?:results|logs)|too many (?:results|logs)|response size|response.*too large|query timeout|query (?:returned|exceeds)|query.*(?:too large|exceed)|log.*limit/i;
const EXPLICIT_CAP = /range\s+\d+\s+exceeds limit of\s+([\d,]+)/i;
const MAX_MATCHED = 1_000;

function isRangeError(error: unknown): boolean {
  return error instanceof RpcError && RANGE_ERROR.test(error.message.slice(0, MAX_MATCHED));
}

/** The block cap in "range N exceeds limit of M" (Infura: to − from <= M). */
function explicitCap(error: unknown): bigint | null {
  if (!(error instanceof RpcError)) return null;
  const cap = EXPLICIT_CAP.exec(error.message.slice(0, MAX_MATCHED))?.[1];
  return cap ? BigInt(cap.replaceAll(",", "")) : null;
}

const firstLine = (error: unknown) => {
  const text = error instanceof Error ? error.message : String(error);
  return text.split("\n")[0] ?? text;
};

const keyOf = (log: IndexedLog) => `${log.blockNumber}:${log.logIndex}`;

function compareLogs(a: IndexedLog, b: IndexedLog) {
  if (a.blockNumber !== b.blockNumber) return a.blockNumber < b.blockNumber ? -1 : 1;
  return a.logIndex - b.logIndex;
}

/** Everything that names one log and what it says: two logs that differ here are not the same. */
const identityOf = (log: IndexedLog) =>
  [
    log.blockNumber,
    log.logIndex,
    log.blockHash,
    log.transactionHash,
    log.transactionIndex,
    log.address,
    log.topics.join(","),
    log.data,
  ]
    .join("|")
    .toLowerCase();

type LogFilterShape = { addresses: readonly Address[]; topic0?: readonly Hex[] | null };

type FilterKeys = { addresses: ReadonlySet<string>; topics: ReadonlySet<string> | null };

const filterKeys = ({ addresses, topic0 }: LogFilterShape): FilterKeys => ({
  addresses: new Set(addresses.map((a) => a.toLowerCase())),
  topics: topic0 ? new Set(topic0.map((t) => t.toLowerCase())) : null,
});

/**
 * Checks an eth_getLogs answer as the index checks every one (throws InvalidLogsAnswer): mined
 * logs only, each from the filter, complete, inside [from, to], none twice. Also for saved logs.
 */
export function parseLogs(
  raw: unknown,
  filter: LogFilterShape,
  from: bigint,
  to: bigint
): IndexedLog[] {
  return checkLogs(raw, filterKeys(filter), from, to, null);
}

function checkLogs(
  raw: unknown,
  keys: FilterKeys,
  from: bigint,
  to: bigint,
  known: ReadonlySet<string> | null
): IndexedLog[] {
  if (!Array.isArray(raw)) throw new InvalidLogsAnswer("eth_getLogs did not answer with a list");
  const seen = new Set<string>();
  const out: IndexedLog[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") throw new InvalidLogsAnswer("a malformed log");
    let log: Log;
    try {
      log = formatLog(entry);
    } catch {
      throw new InvalidLogsAnswer("a malformed log");
    }
    if ((entry as { removed?: unknown }).removed === true)
      throw new InvalidLogsAnswer("a removed log");
    if (typeof log.address !== "string" || !keys.addresses.has(log.address.toLowerCase()))
      throw new InvalidLogsAnswer("a log from another address");
    if (
      log.blockNumber === null ||
      log.logIndex === null ||
      !log.blockHash ||
      !log.transactionHash ||
      !Array.isArray(log.topics) ||
      typeof log.data !== "string"
    )
      throw new InvalidLogsAnswer("a log without its block, index, hash or data");
    if (keys.topics && !keys.topics.has(String(log.topics[0]).toLowerCase()))
      throw new InvalidLogsAnswer("a log the filter does not ask for");
    if (log.blockNumber < from || log.blockNumber > to)
      throw new InvalidLogsAnswer(
        `a log at block ${log.blockNumber}, outside the requested ${from}-${to}`
      );
    const indexed = log as IndexedLog;
    const key = keyOf(indexed);
    if (seen.has(key) || known?.has(key))
      throw new InvalidLogsAnswer(`the same log twice (block ${log.blockNumber})`);
    seen.add(key);
    out.push(indexed);
  }
  return out.sort(compareLogs);
}

/** The same logs, each saying the same thing (see identityOf). Both lists in (block, index) order. */
function sameLogs(a: readonly IndexedLog[], b: readonly IndexedLog[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++)
    if (identityOf(a[i] as IndexedLog) !== identityOf(b[i] as IndexedLog)) return false;
  return true;
}

const max = (a: bigint, b: bigint) => (a > b ? a : b);
const min = (a: bigint, b: bigint) => (a < b ? a : b);
const median = (values: readonly number[]) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;

function chunksOf(range: Range, span: bigint): Range[] {
  const out: Range[] = [];
  for (let to = range.to; to >= range.from; to -= span) {
    out.push({ from: max(range.from, to - span + 1n), to });
  }
  return out;
}

export function createLogIndex(options: LogIndexOptions): LogIndex {
  const { label, lane, deployBlock } = options;
  const quickLane = options.quickLane ?? lane;
  const addresses: readonly Address[] =
    typeof options.address === "string" ? [options.address] : [...options.address];
  if (addresses.length === 0) throw new Error(`The ${label} log index needs an address`);
  const keys = filterKeys({ addresses, topic0: options.topic0 });
  const filter = {
    address: addresses.length === 1 ? addresses[0] : addresses,
    ...(options.topic0 ? { topics: [[...options.topic0]] } : {}),
  };
  const defaultWaitMs = options.waitMs ?? 20_000;
  const hedgeMs = options.hedgeMs ?? 2_500;
  const chunkRetries = options.chunkRetries ?? 3;
  const retryDelayMs = options.retryDelayMs ?? 250;
  const retryMs = options.retryMs ?? 10_000;
  const minSpan = options.minSpan ?? MIN_SPAN;
  const describe = options.describeError ?? firstLine;

  let closed = false;
  const current = () => !closed && (options.isCurrent?.() ?? true);

  // Final coverage [bottom, top]; empty while bottom > top. Anchored at the finality boundary
  // the first time a head is seen: the backfill moves `bottom` down, new heads move `top` up.
  let anchored = false;
  let top = 0n;
  let bottom = 0n;
  let final: IndexedLog[] = [];
  const finalKeys = new Set<string>();
  let tail: Tail | null = null;
  // Chunks that landed below a chunk still missing; committed once the gap above them closes.
  const pending = new Map<bigint, Landed>();

  // The index-wide span: set only by an explicit cap or the backfill's first probe (a range error
  // anywhere else splits that one range).
  let span: bigint | null = null;
  let spanIsCap = false;
  let strategy: IndexStatus["strategy"] = null;
  let run: Promise<void> | null = null;
  let failure: Failure | null = null;
  let chunksDone = 0;
  let chunksTotal = 0;

  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of [...listeners]) listener();
  };

  type Bridge = { to: bigint; logs: Promise<IndexedLog[]> };
  type Seeded = {
    state: ProvisionalStatus["state"];
    finalizedTo: bigint;
    logs: IndexedLog[];
    count: number;
    onOutcome?: (outcome: ProvisionalOutcome) => void;
    bridge: Bridge | null;
  };
  let seeded: Seeded | null = null;

  const complete = () => anchored && bottom <= deployBlock;

  function anchor(safe: bigint) {
    if (anchored) return;
    anchored = true;
    top = safe < deployBlock - 1n ? deployBlock - 1n : safe;
    bottom = top + 1n;
    if (seeded?.state === "provisional" && bridgeable(seeded)) startBridge(seeded);
  }

  /** [from, ∞) is answerable: final coverage reaches down to `from`, or `from` is in the tail. */
  function covers(from: bigint) {
    return anchored && (bottom <= from || from > top);
  }

  function ensureCurrent() {
    if (!current()) throw new IndexClosed(label);
  }

  function unavailable(f: Failure) {
    return new IndexUnavailable(f.message, f.from, f.to);
  }

  /** Checked logs in [from, to]; one already final is a duplicate, unless `apart` (the bridge). */
  async function getLogs(
    from: bigint,
    to: bigint,
    apart = false,
    via: Lane = lane
  ): Promise<IndexedLog[]> {
    const raw = await via.request<unknown>("eth_getLogs", [
      { ...filter, fromBlock: numberToHex(from), toBlock: numberToHex(to) },
    ]);
    return checkLogs(raw, keys, from, to, apart ? null : finalKeys);
  }

  function adoptCap(cap: bigint) {
    if (spanIsCap && span !== null && span <= cap) return;
    span = cap;
    spanIsCap = true;
    if (current()) options.onCap?.(cap);
  }

  function onRangeError(error: unknown, size: bigint): { cap: bigint } | { half: bigint } | null {
    const cap = explicitCap(error);
    if (cap !== null) return cap < size && cap >= minSpan ? { cap } : null;
    return size > minSpan ? { half: max((size + 1n) / 2n, minSpan) } : null;
  }

  const backoff = (attempt: number) =>
    new Promise((resolve) => setTimeout(resolve, retryDelayMs * attempt));

  /** All logs in [from, to] in pieces of at most `limit`; a range error splits this read only. */
  async function fetchRange(
    from: bigint,
    to: bigint,
    limit: bigint | null = span,
    attempt = 0,
    apart = false
  ): Promise<IndexedLog[]> {
    if (from > to) return [];
    const size = to - from + 1n;
    if (limit !== null && size > limit) {
      const parts = await Promise.all(
        chunksOf({ from, to }, limit).map((part) => fetchRange(part.from, part.to, limit, 0, apart))
      );
      return parts.flat().sort(compareLogs);
    }
    try {
      // Until the history is complete, never in a POST with the backfill's chunks.
      return await getLogs(from, to, apart, complete() ? lane : quickLane);
    } catch (error) {
      const next = isRangeError(error) ? onRangeError(error, size) : null;
      if (!next) {
        if (attempt >= chunkRetries || !current()) throw error;
        await backoff(attempt + 1);
        return fetchRange(from, to, limit, attempt + 1, apart);
      }
      if ("cap" in next) {
        adoptCap(next.cap);
        return fetchRange(from, to, next.cap, 0, apart);
      }
      return fetchRange(from, to, next.half, 0, apart);
    }
  }

  function fetchChunk(chunk: Range): { promise: Promise<IndexedLog[]>; hedge: () => boolean } {
    let settled = false;
    let outstanding = 0;
    let hedged = false;
    let settle!: { resolve: (logs: IndexedLog[]) => void; reject: (error: unknown) => void };
    const promise = new Promise<IndexedLog[]>((resolve, reject) => {
      settle = { resolve, reject };
    });
    const attempt = () => {
      outstanding++;
      getLogs(chunk.from, chunk.to).then(
        (logs) => {
          outstanding--;
          if (settled) return;
          settled = true;
          settle.resolve(logs);
        },
        (error: unknown) => {
          outstanding--;
          if (settled || outstanding > 0) return;
          settled = true;
          settle.reject(error);
        }
      );
    };
    attempt();
    return {
      promise,
      hedge() {
        if (settled || hedged) return false;
        hedged = true;
        attempt();
        return true;
      },
    };
  }

  function land(range: Range, logs: IndexedLog[]) {
    if (!current()) return;
    chunksDone++;
    pending.set(range.to, { ...range, logs });
    let moved = false;
    for (let next = pending.get(bottom - 1n); next; next = pending.get(bottom - 1n)) {
      pending.delete(next.to);
      const fresh = next.logs.filter((log) => !finalKeys.has(keyOf(log)));
      for (const log of fresh) finalKeys.add(keyOf(log));
      final = [...fresh, ...final];
      bottom = next.from;
      moved = true;
    }
    if (!moved) return;
    notify();
    checkSeeded();
  }

  function gaps(): Range[] {
    const out: Range[] = [];
    let cursor = bottom - 1n;
    const landed = [...pending.values()].sort((a, b) => (a.to > b.to ? -1 : 1));
    for (const chunk of landed) {
      if (chunk.to < cursor) out.push({ from: chunk.to + 1n, to: cursor });
      cursor = min(cursor, chunk.from - 1n);
    }
    if (cursor >= deployBlock) out.push({ from: deployBlock, to: cursor });
    return out;
  }

  function fail(error: unknown, range: Range) {
    if (!current()) return;
    const message = describe(error);
    failure = { message, error, ...range, at: Date.now() };
    defaultLogger.warn(
      { index: label, from: range.from.toString(), to: range.to.toString(), error: message },
      "Log index backfill failed; committed coverage is kept"
    );
    notify();
  }

  // About as many chunks outstanding as the lane can send at once; a slow one is sent once more
  // (after hedgeMs and twice the usual time), at most a POST's worth at a time.
  function drain(work: Chunk[]): Promise<void> {
    return new Promise((resolve) => {
      let stopped = false;
      type Flight = {
        startedAt: number;
        sentBy: number | undefined;
        hedged: boolean;
        hedge: () => boolean;
      };
      const flights = new Map<Chunk, Flight>();
      const latencies: number[] = [];
      let landings = 0;
      let failures = 0;
      const capacity = () => {
        const stats = lane.stats();
        return Math.max(1, stats.batch * stats.inFlightLimit);
      };
      const scanner = setInterval(
        () => {
          const stats = lane.stats();
          // Requests still queued in the lane (or paused by a rate limit) are not slow upstream.
          if (stats.queued > 0 || stats.pausedMs > 0) return;
          const now = Date.now();
          const threshold = latencies.length > 0 ? Math.max(hedgeMs, 2 * median(latencies)) : null;
          let hedges = 0;
          for (const flight of flights.values()) if (flight.hedged) hedges++;
          for (const flight of flights.values()) {
            if (flight.sentBy === undefined) flight.sentBy = now;
            else if (
              threshold !== null &&
              hedges < stats.batch &&
              !flight.hedged &&
              now - flight.sentBy >= threshold &&
              flight.hedge()
            ) {
              flight.hedged = true;
              hedges++;
            }
          }
        },
        Math.max(5, Math.min(250, Math.floor(hedgeMs / 4)))
      );
      const finish = () => {
        if (flights.size > 0 || (!stopped && work.length > 0)) return;
        clearInterval(scanner);
        resolve();
      };
      const split = (chunk: Chunk, size: bigint) => {
        const pieces = chunksOf(chunk, size);
        chunksTotal += pieces.length - 1;
        work.unshift(...pieces.map((piece) => ({ ...piece, attempts: 0 })));
      };
      const failed = async (chunk: Chunk, error: unknown) => {
        const size = chunk.to - chunk.from + 1n;
        const next = isRangeError(error) ? onRangeError(error, size) : null;
        const previous = chunk.lastFailure;
        failures++;
        chunk.lastFailure = { landings, failures };
        const burst =
          previous !== undefined &&
          landings === previous.landings &&
          failures - 1 - previous.failures >= BURST_FAILURES;
        if (!current()) {
          stopped = true;
        } else if (next && "cap" in next) {
          adoptCap(next.cap);
          split(chunk, next.cap);
        } else if (next && "half" in next && previous !== undefined && !burst) {
          // No cap named: the first range error is retried as is (a passing "query timeout" costs
          // one request); a range that fails again is too dense, and only it is split. A burst that
          // hits every range at once is an ordinary failure: retries, then unavailable.
          split(chunk, next.half);
        } else if (chunk.attempts < chunkRetries) {
          chunk.attempts++;
          await backoff(chunk.attempts);
          work.unshift(chunk);
        } else {
          stopped = true;
          fail(error, chunk);
        }
      };
      const pump = () => {
        if (!current()) stopped = true;
        while (!stopped && work.length > 0 && flights.size < capacity()) {
          const chunk = work.shift() as Chunk;
          const { promise, hedge } = fetchChunk(chunk);
          const startedAt = Date.now();
          flights.set(chunk, { startedAt, sentBy: undefined, hedged: false, hedge });
          promise
            .then(
              (logs) => {
                flights.delete(chunk);
                landings++;
                latencies.push(Date.now() - startedAt);
                if (latencies.length > LATENCY_SAMPLES) latencies.shift();
                land(chunk, logs);
              },
              // Stays counted while it waits to be retried, so the run cannot end meanwhile.
              (error: unknown) => failed(chunk, error).finally(() => flights.delete(chunk))
            )
            .catch((error: unknown) => {
              flights.delete(chunk);
              stopped = true;
              fail(error, chunk);
            })
            .finally(() => {
              pump();
              finish();
            });
        }
        finish();
      };
      pump();
    });
  }

  // The newest piece of `gap` the RPC accepts in one request: halved one request at a time without
  // an explicit cap (one probe, not a fan-out of failures), never below `minSpan`.
  async function probe(
    gap: Range
  ): Promise<{ landed: Landed } | { cap: bigint } | { error: unknown; range: Range }> {
    let size = gap.to - gap.from + 1n;
    let retries = 0;
    for (;;) {
      const from = gap.to - size + 1n;
      try {
        return { landed: { from, to: gap.to, logs: await getLogs(from, gap.to) } };
      } catch (error) {
        if (!isRangeError(error)) {
          if (retries >= chunkRetries || !current()) return { error, range: { from, to: gap.to } };
          retries++;
          await backoff(retries);
          continue;
        }
        const next = onRangeError(error, size);
        if (!next) return { error, range: { from, to: gap.to } };
        // An explicit cap needs no probing: every chunk goes out at once.
        if ("cap" in next) {
          adoptCap(next.cap);
          return { cap: next.cap };
        }
        size = max(size / 2n, minSpan);
      }
    }
  }

  async function backfill(): Promise<void> {
    const startedAt = Date.now();
    try {
      const head = await options.head();
      if (!current()) return;
      anchor(head.safe);
    } catch (error) {
      fail(error, { from: deployBlock, to: deployBlock });
      return;
    }
    if (complete()) return;

    let todo = gaps();
    if (span === null) {
      const gap = todo[0] as Range;
      const result = await probe(gap);
      if (!current()) return;
      if ("error" in result) {
        fail(result.error, result.range);
        return;
      }
      if ("landed" in result) {
        const whole = result.landed.from === gap.from;
        strategy = whole ? "full-range" : "chunked";
        chunksTotal += 1;
        land(result.landed, result.landed.logs);
        if (whole) return finished(startedAt);
        span ??= result.landed.to - result.landed.from + 1n;
      } else {
        strategy = "chunked";
      }
      todo = gaps();
    }
    strategy ??= "chunked";
    const work = todo.flatMap((gap) =>
      chunksOf(gap, span as bigint).map((chunk) => ({ ...chunk, attempts: 0 }))
    );
    chunksTotal = chunksDone + work.length;
    await drain(work);
    if (current() && !failure) finished(startedAt);
  }

  function finished(startedAt: number) {
    if (!complete()) {
      // Every chunk landed, so this cannot happen; never report a gap as covered.
      fail(new Error("the backfill ended with a gap"), { from: deployBlock, to: bottom - 1n });
      return;
    }
    defaultLogger.info(
      {
        index: label,
        strategy,
        span: span?.toString(),
        chunks: chunksDone,
        logs: final.length,
        elapsedMs: Date.now() - startedAt,
      },
      "Log index backfilled"
    );
  }

  function startBackfill(): Promise<void> {
    if (!current() || complete()) return Promise.resolve();
    if (run) {
      if (!failure) return run;
      // A failed run is still draining its outstanding chunks: resume once they have landed.
      return run.then(() => startBackfill());
    }
    failure = null;
    // Never paced (sync/pacer.ts): a backfill is not the engine's per-block work.
    const thisRun: Promise<void> = asRequestWork(backfill)
      .catch((error: unknown) => fail(error, { from: deployBlock, to: bottom - 1n }))
      .finally(() => {
        if (run === thisRun) run = null;
        notify();
      });
    run = thisRun;
    notify();
    return thisRun;
  }

  let chain: Promise<unknown> = Promise.resolve();
  // The reads for the last few heads: a query answers from its own head's read, so queries at the
  // head still served while the engine reads the next one do not read theirs again.
  const recentSyncs = new Map<string, Promise<Tail>>();
  const RECENT_HEADS = 4;

  // Reads (finalizedTo, head] once per head, one at a time, and promotes what is now final from
  // that fresh read only; a query answers from its own head's read.
  function sync(head: IndexHead): Promise<Tail> {
    const key = `${head.head.number}:${head.head.hash.toLowerCase()}`;
    const known = recentSyncs.get(key);
    if (known) return known;
    const promise = chain.then(() => applyHead(head));
    chain = promise.catch(() => {});
    recentSyncs.set(key, promise);
    for (const old of recentSyncs.keys()) {
      if (recentSyncs.size <= RECENT_HEADS) break;
      recentSyncs.delete(old);
    }
    promise.catch(() => {
      if (recentSyncs.get(key) === promise) recentSyncs.delete(key);
    });
    return promise;
  }

  async function applyHead({ head, safe }: IndexHead): Promise<Tail> {
    ensureCurrent();
    anchor(safe);
    const from = max(top + 1n, deployBlock);
    let logs: IndexedLog[] = [];
    if (head.number >= from) {
      try {
        logs = await fetchRange(from, head.number);
      } catch (error) {
        ensureCurrent();
        throw new IndexUnavailable(describe(error), from, head.number);
      }
    }
    // Late results from older settings are never inserted.
    ensureCurrent();
    const boundary = min(safe, head.number);
    if (boundary > top) {
      const promoted = logs.filter((log) => log.blockNumber <= boundary);
      for (const log of promoted) finalKeys.add(keyOf(log));
      final = [...final, ...promoted];
      top = boundary;
    }
    const read: Tail = { head, logs: logs.filter((log) => log.blockNumber > top) };
    tail = read;
    notify();
    // A seeded history above the boundary at completion is checked once the boundary reaches it.
    checkSeeded();
    return read;
  }

  function report(entry: Seeded, outcome: ProvisionalOutcome) {
    try {
      entry.onOutcome?.(outcome);
    } catch {
      // The listener's failure is its own.
    }
  }

  // Once the backfill covers the seeded range: the same logs, each saying the same thing, is
  // "verified"; anything else a "mismatch". The seeded logs are dropped either way.
  function checkSeeded() {
    const entry = seeded;
    if (!entry || entry.state !== "provisional" || !complete() || top < entry.finalizedTo) return;
    const fresh = final.filter((log) => log.blockNumber <= entry.finalizedTo);
    entry.state = sameLogs(fresh, entry.logs) ? "verified" : "mismatch";
    entry.logs = [];
    entry.bridge = null;
    report(entry, entry.state);
  }

  // A bridge only once the boundary has reached the seeded last block (else part of this run's
  // range would be read twice), and only for a narrow gap.
  function bridgeable(entry: Seeded): boolean {
    if (top < entry.finalizedTo) return false;
    return top - entry.finalizedTo <= (span ?? BRIDGE_DEFAULT_SPAN) * BRIDGE_MAX_CHUNKS;
  }

  function startBridge(entry: Seeded): Bridge {
    if (entry.bridge) return entry.bridge;
    const from = entry.finalizedTo + 1n;
    const to = top;
    const bridge: Bridge = {
      to,
      logs: from > to ? Promise.resolve([]) : fetchRange(from, to, span, 0, true),
    };
    entry.bridge = bridge;
    // A failed read is read again by the next page that needs it.
    bridge.logs.catch(() => {
      if (entry.bridge === bridge) entry.bridge = null;
    });
    return bridge;
  }

  function seedProvisional(
    seed: ProvisionalSeed,
    onOutcome?: (outcome: ProvisionalOutcome) => void
  ): boolean {
    if (!current() || seeded !== null || seed.finalizedTo < deployBlock) return false;
    const logs = [...seed.logs].sort(compareLogs);
    for (const log of logs)
      if (
        log.blockNumber < deployBlock ||
        log.blockNumber > seed.finalizedTo ||
        !keys.addresses.has(log.address.toLowerCase())
      )
        return false;
    const entry: Seeded = {
      state: "provisional",
      finalizedTo: seed.finalizedTo,
      logs,
      count: logs.length,
      onOutcome,
      bridge: null,
    };
    seeded = entry;
    checkSeeded();
    if (entry.state === "provisional" && anchored && bridgeable(entry)) startBridge(entry);
    return true;
  }

  // A page's answer from the seeded history: its logs, the bridge above them, and this run's reads
  // above that; null when it should not answer from there (the query then reads as any other).
  async function fromSeeded(query: LogQuery & { head: IndexHead }): Promise<IndexRead | null> {
    const entry = seeded;
    const observed = query.head;
    const from = max(query.fromBlock ?? deployBlock, deployBlock);
    if (!entry || entry.state !== "provisional" || covers(from)) return null;
    if (entry.finalizedTo > observed.safe || entry.finalizedTo > top) return null;
    // A bridge ending below the seeded last block would overlap the seeded logs: never used.
    if (entry.bridge && entry.bridge.to < entry.finalizedTo) entry.bridge = null;
    const bridge = entry.bridge ?? (bridgeable(entry) ? startBridge(entry) : null);
    if (!bridge && from > entry.finalizedTo) return null;
    if (!complete() && !recentFailure()) void startBackfill();
    const upper = query.toBlock ?? observed.head.number;
    const lower = max(from, max(bridge?.to ?? entry.finalizedTo, entry.finalizedTo) + 1n);
    const above = upper >= lower ? read({ ...query, fromBlock: lower, provisional: false }) : null;
    void above?.catch(() => {});
    let bridged: IndexedLog[] = [];
    if (bridge) {
      try {
        bridged = await bridge.logs;
      } catch {
        return null;
      }
    }
    const rest = await above;
    ensureCurrent();
    // Verified (or found wrong) meanwhile: this run's index answers instead.
    if (entry.state !== "provisional" || seeded !== entry) return null;
    const within = (log: IndexedLog) => log.blockNumber >= from && log.blockNumber <= upper;
    const logs = [...entry.logs.filter(within), ...bridged.filter(within), ...(rest?.logs ?? [])];
    // The three parts cover disjoint blocks, so no log can be in two. Should one ever be, the
    // answer is not given from the seeded history at all.
    if (new Set(logs.map(keyOf)).size !== logs.length) return null;
    return {
      logs,
      finalTo: rest?.finalTo ?? top,
      provisionalTo: from <= entry.finalizedTo ? entry.finalizedTo : null,
    };
  }

  function waitFor(from: bigint, waitMs: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(signal.reason ?? new Error("aborted"));
      const timer = setTimeout(
        () => done(() => reject(new IndexIncomplete(label, from, bottom <= top ? bottom : null))),
        Math.max(0, waitMs)
      );
      const done = (settle: () => void) => {
        listeners.delete(check);
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        settle();
      };
      const onAbort = () => done(() => reject(signal?.reason ?? new Error("aborted")));
      function check() {
        if (!current()) return done(() => reject(new IndexClosed(label)));
        if (covers(from)) return done(resolve);
        if (failure) {
          const f = failure;
          return done(() => reject(unavailable(f)));
        }
      }
      listeners.add(check);
      signal?.addEventListener("abort", onAbort, { once: true });
      check();
    });
  }

  /** The failure a query reports for now instead of hammering the RPC; null to resume. */
  const recentFailure = () =>
    failure !== null && Date.now() - failure.at < retryMs ? failure : null;

  async function read(query: LogQuery = {}): Promise<IndexRead> {
    ensureCurrent();
    if (query.provisional && seeded?.state === "provisional") {
      const observed = query.head ?? (await options.head());
      ensureCurrent();
      anchor(observed.safe);
      const answer = await fromSeeded({ ...query, head: observed });
      if (answer) return answer;
      return read({ ...query, head: observed, provisional: false });
    }
    const from = max(query.fromBlock ?? deployBlock, deployBlock);
    const observed = query.head ?? (await options.head());
    ensureCurrent();
    anchor(observed.safe);
    if (!complete()) {
      const recent = recentFailure();
      if (recent && !covers(from)) throw unavailable(recent);
      if (!recent) void startBackfill();
    }
    const to = query.toBlock;
    if (to !== undefined && to < from) return { logs: [], finalTo: top, provisionalTo: null };
    // The coverage wait also ends when the tail read fails, so its timer never outlives the query.
    const stop = new AbortController();
    const forward = () => stop.abort(query.signal?.reason ?? new Error("aborted"));
    if (query.signal?.aborted) forward();
    else query.signal?.addEventListener("abort", forward, { once: true });
    let own: Tail | null;
    try {
      [own] = await Promise.all([
        to === undefined || to > top
          ? sync(observed).catch((error: unknown) => {
              stop.abort(error);
              throw error;
            })
          : null,
        waitFor(from, query.waitMs ?? defaultWaitMs, stop.signal),
      ]);
    } finally {
      query.signal?.removeEventListener("abort", forward);
    }
    ensureCurrent();
    const upper = to ?? observed.head.number;
    const out = final.filter((log) => log.blockNumber >= from && log.blockNumber <= upper);
    // The read for this query's own head. What a newer head promoted since is in `final` already.
    for (const log of own?.logs ?? [])
      if (log.blockNumber > top && log.blockNumber >= from && log.blockNumber <= upper)
        out.push(log);
    // `final` holds only logs at or below `top`; the tail part only logs above it.
    return { logs: out, finalTo: top, provisionalTo: null };
  }

  async function syncHead(head?: IndexHead): Promise<void> {
    ensureCurrent();
    const observed = head ?? (await options.head());
    ensureCurrent();
    anchor(observed.safe);
    if (!complete() && !recentFailure()) void startBackfill();
    await sync(observed);
  }

  return {
    startBackfill,
    logs: async (query) => (await read(query)).logs,
    read,
    syncHead,
    seedProvisional,
    dropProvisional() {
      if (seeded?.state === "provisional") seeded = null;
    },
    finalSnapshot: () =>
      complete() ? { coveredFrom: deployBlock, finalizedTo: top, logs: final } : null,
    finalRange: () => (anchored && bottom <= top ? { from: bottom, to: top } : null),
    status(): IndexStatus {
      const state: IndexState = failure
        ? "unavailable"
        : complete()
          ? "ready"
          : run
            ? "backfilling"
            : "idle";
      const coveredFrom = !anchored
        ? null
        : bottom <= top
          ? bottom
          : complete()
            ? deployBlock
            : null;
      return {
        state,
        deployBlock: deployBlock.toString(),
        coveredFrom: coveredFrom?.toString() ?? null,
        finalizedTo: anchored ? top.toString() : null,
        headTo: tail ? tail.head.number.toString() : null,
        chunks: { done: chunksDone, total: chunksTotal },
        strategy,
        span: span?.toString() ?? null,
        logs: final.length + (tail?.logs.length ?? 0),
        error: failure?.message ?? null,
        provisional: seeded && {
          state: seeded.state,
          finalizedTo: seeded.finalizedTo.toString(),
          logs: seeded.count,
        },
      };
    },
    close() {
      if (closed) return;
      closed = true;
      final = [];
      finalKeys.clear();
      pending.clear();
      recentSyncs.clear();
      tail = null;
      const unchecked = seeded?.state === "provisional" ? seeded : null;
      seeded = null;
      notify();
      if (unchecked) report(unchecked, "dropped");
    },
  };
}
