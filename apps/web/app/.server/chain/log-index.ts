import { defaultLogger } from "@config/log.server";
import { type Address, type Hex, type Log, formatLog, numberToHex } from "viem";
import { LogsUnavailableError } from "../logs";
import { type Lane, RpcError } from "./jsonrpc";

// Every log one contract has emitted, from its deployment to the head, in memory. The filter is
// the address alone: a topic OR-list would drop events the ABI does not list (a proxy's Upgraded,
// Initialized and AdminChanged).
//
// Coverage is one contiguous range [coveredFrom, finalizedTo] of final blocks, plus a tail
// (finalizedTo, head] that is read again for every new head and replaces the previous tail. The
// backfill fills the final range downward from the finality boundary, newest blocks first, and a
// query waits (bounded) until the range it asks for is covered. It never answers with a partial
// list.

/** The head a query is answered at, and the finality boundary F: blocks <= F never change. */
export type IndexHead = { head: { number: bigint; hash: Hex }; safe: bigint };

/** A log the index accepted: mined, from the indexed address, inside the range it was read for. */
export type IndexedLog = Log<bigint, number, false>;

export type IndexState = "idle" | "backfilling" | "ready" | "unavailable";

export type IndexStatus = {
  state: IndexState;
  deployBlock: string;
  /** Lowest block of the contiguous final coverage; null before anything is covered. */
  coveredFrom: string | null;
  /** Highest final block covered (the finality boundary the index has reached). */
  finalizedTo: string | null;
  /** Head of the last tail read. */
  headTo: string | null;
  chunks: { done: number; total: number };
  /** "full-range": the RPC answered the whole history at once; "chunked": block range limits. */
  strategy: "full-range" | "chunked" | null;
  /** Largest block range per eth_getLogs, once the RPC has limited it. */
  span: string | null;
  logs: number;
  error: string | null;
};

export type LogQuery = {
  /** Defaults to the deployment block. */
  fromBlock?: bigint;
  /** Defaults to the head. */
  toBlock?: bigint;
  /** How long to wait for the backfill to cover `fromBlock` before IndexIncomplete. */
  waitMs?: number;
  signal?: AbortSignal;
};

export type LogIndexOptions = {
  /** Names the index in errors and logs. */
  label: string;
  /** eth_getLogs goes through this lane (batching, rate limits, read-only allowlist). */
  lane: Lane;
  address: Address;
  /** First block with a log of this contract. Nothing earlier is read. */
  deployBlock: bigint;
  head: () => Promise<IndexHead>;
  /** False once the settings this index was built for changed: nothing more is inserted. */
  isCurrent?: () => boolean;
  /** Error text for status and logs. Must not reveal RPC URLs. */
  describeError?: (error: unknown) => string;
  /** Default wait for coverage in a query. */
  waitMs?: number;
  /**
   * A chunk outstanding this long (and twice as long as chunks usually take) is sent once more;
   * the first answer wins.
   */
  hedgeMs?: number;
  /**
   * Smallest block range the index splits a request into (default 1,000, as logs.ts). A range
   * error at or below it, or an explicit cap below it, makes the backfill unavailable.
   */
  minSpan?: bigint;
  /** Retries of one chunk after an error that is not about its range. */
  chunkRetries?: number;
  retryDelayMs?: number;
  /** After a failed backfill, queries report it for this long before trying again. */
  retryMs?: number;
};

export interface LogIndex {
  readonly label: string;
  readonly address: Address;
  readonly deployBlock: bigint;
  /**
   * Starts (or resumes) the backfill of the final range. Never rejects; resolves when this run
   * ends. A run keeps going when the request that started it is gone.
   */
  startBackfill(): Promise<void>;
  status(): IndexStatus;
  /** The committed contiguous final range, or null. */
  finalRange(): { from: bigint; to: bigint } | null;
  /** Every log in [fromBlock, toBlock], complete, ordered by (blockNumber, logIndex). */
  logs(query?: LogQuery): Promise<IndexedLog[]>;
  /** Drops everything; later results are discarded and queries fail. */
  close(): void;
}

/** The index has not covered the requested range within the wait. */
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

/** The backfill failed: the RPC refused or kept failing eth_getLogs. */
export class IndexUnavailable extends LogsUnavailableError {
  override name = "IndexUnavailable";
}

/** The data source changed after this index was built. */
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
/** `lastFailure`: how many chunks of the run had landed and failed when this one last failed. */
type Chunk = Range & { attempts: number; lastFailure?: { landings: number; failures: number } };
type Landed = Range & { logs: IndexedLog[] };
type Failure = { message: string; error: unknown; from: bigint; to: bigint; at: number };
/** One read of (finalizedTo, head]: the logs above the boundary at that head. */
type Tail = { head: { number: bigint; hash: Hex }; logs: IndexedLog[] };

/** Below this many blocks per eth_getLogs, a history backfill is hopeless (logs.ts MIN_SPAN). */
export const MIN_SPAN = 1_000n;
// Answer times kept to judge whether a chunk is slow compared with the others.
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
// Range answers are short. Only the start of a message is matched, so a huge one stays cheap.
const MAX_MATCHED = 1_000;

export function isRangeError(error: unknown): boolean {
  return error instanceof RpcError && RANGE_ERROR.test(error.message.slice(0, MAX_MATCHED));
}

/** The block cap in "range N exceeds limit of M" (Infura: to − from <= M). */
export function explicitCap(error: unknown): bigint | null {
  if (!(error instanceof RpcError)) return null;
  const cap = EXPLICIT_CAP.exec(error.message.slice(0, MAX_MATCHED))?.[1];
  return cap ? BigInt(cap.replaceAll(",", "")) : null;
}

const firstLine = (error: unknown) => {
  const text = error instanceof Error ? error.message : String(error);
  return text.split("\n")[0] ?? text;
};

const keyOf = (log: IndexedLog) => `${log.blockNumber}:${log.logIndex}`;

export function compareLogs(a: IndexedLog, b: IndexedLog) {
  if (a.blockNumber !== b.blockNumber) return a.blockNumber < b.blockNumber ? -1 : 1;
  return a.logIndex - b.logIndex;
}

const max = (a: bigint, b: bigint) => (a > b ? a : b);
const min = (a: bigint, b: bigint) => (a < b ? a : b);
const median = (values: readonly number[]) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;

/** Splits [from, to] into ranges of at most `span` blocks, newest first. */
export function chunksOf(range: Range, span: bigint): Range[] {
  const out: Range[] = [];
  for (let to = range.to; to >= range.from; to -= span) {
    out.push({ from: max(range.from, to - span + 1n), to });
  }
  return out;
}

export function createLogIndex(options: LogIndexOptions): LogIndex {
  const { label, lane, address, deployBlock } = options;
  const addressKey = address.toLowerCase();
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
  // The last tail read, for status. A query answers from the read for its own head.
  let tail: Tail | null = null;
  // Chunks that landed below a chunk still missing; committed once the gap above them closes.
  const pending = new Map<bigint, Landed>();

  // The block range the whole index uses per eth_getLogs. Only an explicit cap in an error, or
  // the halving probe on the backfill's first request, sets it: a range error anywhere else
  // splits that one range and leaves this alone.
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

  const complete = () => anchored && bottom <= deployBlock;

  function anchor(safe: bigint) {
    if (anchored) return;
    anchored = true;
    top = safe < deployBlock - 1n ? deployBlock - 1n : safe;
    bottom = top + 1n;
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

  // ---- eth_getLogs ----

  async function getLogs(from: bigint, to: bigint): Promise<IndexedLog[]> {
    // Address only: no `topics` key at all.
    const raw = await lane.request<unknown>("eth_getLogs", [
      { address, fromBlock: numberToHex(from), toBlock: numberToHex(to) },
    ]);
    return validate(raw, from, to);
  }

  function validate(raw: unknown, from: bigint, to: bigint): IndexedLog[] {
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
      if (typeof log.address !== "string" || log.address.toLowerCase() !== addressKey)
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
      if (log.blockNumber < from || log.blockNumber > to)
        throw new InvalidLogsAnswer(
          `a log at block ${log.blockNumber}, outside the requested ${from}-${to}`
        );
      const indexed = log as IndexedLog;
      const key = keyOf(indexed);
      if (seen.has(key) || finalKeys.has(key))
        throw new InvalidLogsAnswer(`the same log twice (block ${log.blockNumber})`);
      seen.add(key);
      out.push(indexed);
    }
    return out.sort(compareLogs);
  }

  /**
   * An explicit cap ("range N exceeds limit of M") is the provider's own limit: it becomes the
   * index's span, replacing one learned by halving, and only a smaller cap lowers it again.
   */
  function adoptCap(cap: bigint) {
    if (spanIsCap && span !== null && span <= cap) return;
    span = cap;
    spanIsCap = true;
  }

  /**
   * How a range error on `size` blocks is handled: a cap the provider named, the half to split
   * this range into, or a plain failure (at or below the floor, or a cap below it).
   */
  function onRangeError(error: unknown, size: bigint): { cap: bigint } | { half: bigint } | null {
    const cap = explicitCap(error);
    if (cap !== null) return cap < size && cap >= minSpan ? { cap } : null;
    return size > minSpan ? { half: max((size + 1n) / 2n, minSpan) } : null;
  }

  /**
   * All logs in [from, to] (used for heads and their gaps), in pieces of at most `limit` blocks.
   * A range error splits this read only; the index-wide span changes only for an explicit cap.
   */
  async function fetchRange(
    from: bigint,
    to: bigint,
    limit: bigint | null = span
  ): Promise<IndexedLog[]> {
    if (from > to) return [];
    const size = to - from + 1n;
    if (limit !== null && size > limit) {
      const parts = await Promise.all(
        chunksOf({ from, to }, limit).map((part) => fetchRange(part.from, part.to, limit))
      );
      return parts.flat().sort(compareLogs);
    }
    try {
      return await getLogs(from, to);
    } catch (error) {
      const next = isRangeError(error) ? onRangeError(error, size) : null;
      if (!next) throw error;
      if ("cap" in next) {
        adoptCap(next.cap);
        return fetchRange(from, to, next.cap);
      }
      return fetchRange(from, to, next.half);
    }
  }

  // ---- backfill ----

  /** One chunk. `hedge()` sends it once more (true if it did); the first answer wins. */
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
          // Wait for the other copy if one is still out.
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
    if (moved) notify();
  }

  /** Ranges of [deployBlock, bottom − 1] not yet fetched, newest first. */
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

  /**
   * Fetches chunks newest-first, about as many outstanding as the lane can send at once. A chunk
   * still unanswered after it was surely sent (the lane had nothing queued) for `hedgeMs`, and for
   * twice as long as chunks usually take, is sent once more; at most one POST's worth at a time,
   * so a provider that is slow for everyone is not sent everything twice.
   */
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
          // Slow only compared with chunks that have answered; none yet means nothing to compare.
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
        // Between this chunk's last failure and this one, nothing landed and many other chunks
        // failed too: the provider is failing everything, not this range.
        const burst =
          previous !== undefined &&
          landings === previous.landings &&
          failures - 1 - previous.failures >= BURST_FAILURES;
        if (!current()) {
          stopped = true;
        } else if (next && "cap" in next) {
          // The provider named its limit: it holds for the whole index.
          adoptCap(next.cap);
          split(chunk, next.cap);
        } else if (next && "half" in next && previous !== undefined && !burst) {
          // No cap named: the first range error is retried as is, so a passing "query timeout"
          // costs one request. A range that fails again is too dense, and only it is split
          // (never below minSpan; the index-wide span stays). A burst that hits every range at
          // once is an ordinary failure: retries, then unavailable.
          split(chunk, next.half);
        } else if (chunk.attempts < chunkRetries) {
          chunk.attempts++;
          await new Promise((r) => setTimeout(r, retryDelayMs * chunk.attempts));
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
              // A bug in the handling above must not leave the run hanging.
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

  /**
   * The newest piece of `gap` the RPC accepts in one request. Without an explicit cap the size is
   * halved one request at a time (a single shared probe, not a fan-out of failures), never below
   * `minSpan`: an RPC that refuses even that serves no usable history, as in logs.ts.
   */
  async function probe(
    gap: Range
  ): Promise<{ landed: Landed } | { cap: bigint } | { error: unknown; range: Range }> {
    let size = gap.to - gap.from + 1n;
    for (;;) {
      const from = gap.to - size + 1n;
      try {
        return { landed: { from, to: gap.to, logs: await getLogs(from, gap.to) } };
      } catch (error) {
        const next = isRangeError(error) ? onRangeError(error, size) : null;
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
      // No pending chunks exist without a span: this is the whole range below the coverage.
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
        // The size the halving probe got accepted, unless a cap was named meanwhile.
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
    // A resumed run counts what already landed plus what is left.
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
    const thisRun: Promise<void> = backfill()
      .catch((error: unknown) => fail(error, { from: deployBlock, to: bottom - 1n }))
      .finally(() => {
        if (run === thisRun) run = null;
        notify();
      });
    run = thisRun;
    notify();
    return thisRun;
  }

  // ---- heads ----

  let chain: Promise<unknown> = Promise.resolve();
  let lastSync: { key: string; promise: Promise<Tail> } | null = null;

  /**
   * Reads (finalizedTo, head] once per head (number and hash); the part at or below the new
   * boundary is promoted to final from this fresh read. Resolves with the read, which is what a
   * query at this head answers from: a later read at another (even an older) head never stands
   * in for it. Reads run one at a time.
   */
  function sync(head: IndexHead): Promise<Tail> {
    const key = `${head.head.number}:${head.head.hash.toLowerCase()}`;
    if (lastSync?.key === key) return lastSync.promise;
    const promise = chain.then(() => applyHead(head));
    chain = promise.catch(() => {});
    const entry = { key, promise };
    lastSync = entry;
    promise.catch(() => {
      if (lastSync === entry) lastSync = null;
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
        // Today's LogsUnavailableError text, without the RPC URL.
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
    return read;
  }

  // ---- queries ----

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

  async function logs(query: LogQuery = {}): Promise<IndexedLog[]> {
    ensureCurrent();
    const from = max(query.fromBlock ?? deployBlock, deployBlock);
    const observed = await options.head();
    ensureCurrent();
    anchor(observed.safe);
    if (!complete()) {
      // After a failure, report it for a while instead of hammering the RPC; then resume.
      const recent = failure !== null && Date.now() - failure.at < retryMs ? failure : null;
      if (recent && !covers(from)) throw unavailable(recent);
      if (!recent) void startBackfill();
    }
    const to = query.toBlock;
    if (to !== undefined && to < from) return [];
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
    return out;
  }

  return {
    label,
    address,
    deployBlock,
    startBackfill,
    logs,
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
      };
    },
    close() {
      if (closed) return;
      closed = true;
      final = [];
      finalKeys.clear();
      pending.clear();
      tail = null;
      notify();
    },
  };
}
