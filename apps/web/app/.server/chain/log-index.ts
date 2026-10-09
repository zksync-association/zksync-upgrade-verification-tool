import { defaultLogger } from "@config/log.server";
import { type Address, type Hex, type Log, formatLog, numberToHex } from "viem";
import { LogsUnavailableError } from "../logs";
import { type Lane, RpcError } from "./jsonrpc";
import { asRequestWork } from "../sync/pacer";

// Every log one contract has emitted, from its deployment to the head, in memory. The filter is
// the address alone: a topic OR-list would drop events the ABI does not list (a proxy's Upgraded,
// Initialized and AdminChanged). An index over several contracts whose other events are not
// needed (the L2 governors' votes) may name the topic0 values it keeps instead.
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

/**
 * A query's answer and the boundary it was given at: every log at or below `finalTo` came from
 * the final range (read at or below the finality boundary, never from an older tail), so it never
 * changes; a log above it is from this head's tail and may still be reorged away.
 *
 * `provisionalTo` (only for a query that allowed it, see LogQuery.provisional): the logs at or
 * below this block come from what a previous run read (seeded from disk) and have not been read
 * again yet. They are neither final nor verified: never kept, and shown only as such. null when
 * every log was read in this run.
 */
export type IndexRead = { logs: IndexedLog[]; finalTo: bigint; provisionalTo: bigint | null };

export type IndexState = "idle" | "backfilling" | "ready" | "unavailable";

/**
 * What a previous run read, seeded from disk (persist/chain-cache.ts): the complete history from
 * the index's first block to `finalizedTo`. Untrusted until this run's own backfill has read the
 * same range: then it is "verified" (the same logs) or a "mismatch" (and dropped).
 */
export type ProvisionalSeed = { finalizedTo: bigint; logs: IndexedLog[] };

/** How a seeded history ended: matched this run's backfill, did not, or was dropped unchecked. */
export type ProvisionalOutcome = "verified" | "mismatch" | "dropped";

export type ProvisionalStatus = {
  state: "provisional" | "verified" | "mismatch";
  /** The seeded history's last block. */
  finalizedTo: string;
  logs: number;
};

/** The complete final history, for saving: [deployBlock, finalizedTo]. */
export type FinalSnapshot = {
  coveredFrom: bigint;
  finalizedTo: bigint;
  logs: readonly IndexedLog[];
};

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
  /** A history seeded from the last run (see ProvisionalSeed), or null when none was. */
  provisional: ProvisionalStatus | null;
};

export type LogQuery = {
  /** Defaults to the deployment block. */
  fromBlock?: bigint;
  /** Defaults to the head. */
  toBlock?: bigint;
  /** How long to wait for the backfill to cover `fromBlock` before IndexIncomplete. */
  waitMs?: number;
  signal?: AbortSignal;
  /** Answer at this head instead of the current one (the sync engine, before it publishes it). */
  head?: IndexHead;
  /**
   * Pages only, never JSON: while a history seeded from the last run awaits verification and the
   * backfill has not covered `fromBlock` yet, answer from that history (and this run's reads
   * above it) instead of waiting. The answer says which part is from the last run
   * (IndexRead.provisionalTo).
   */
  provisional?: boolean;
};

export type LogIndexOptions = {
  /** Names the index in errors and logs. */
  label: string;
  /** eth_getLogs goes through this lane (batching, rate limits, read-only allowlist). */
  lane: Lane;
  /**
   * Carries the small reads a query waits on (the tail for a head, the bridge above a seeded
   * history) until the history is complete, so they never wait in a POST with (or queue behind)
   * the backfill's chunks. Default: `lane`.
   */
  quickLane?: Lane;
  /** The contract, or the contracts (one eth_getLogs for all), whose logs are indexed. */
  address: Address | readonly Address[];
  /**
   * Only logs whose topic0 is one of these (an OR-list in the filter). Omitted: every log of the
   * address(es), with no `topics` key in the filter at all.
   */
  topic0?: readonly Hex[];
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
  /** Told the block range cap the provider named ("range N exceeds limit of M"), once adopted. */
  onCap?: (cap: bigint) => void;
};

export interface LogIndex {
  readonly label: string;
  readonly addresses: readonly Address[];
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
  /** As logs(), with the finality boundary the answer was given at (see IndexRead). */
  read(query?: LogQuery): Promise<IndexRead>;
  /**
   * Reads the tail (finalizedTo, head] for the current head (or `head`) now, as the first query
   * at that head would (and shared with it), and starts or resumes the backfill. Rejects when the
   * tail cannot be read.
   */
  syncHead(head?: IndexHead): Promise<void>;
  /**
   * Seeds the history a previous run read (see ProvisionalSeed). Pages may read it (see
   * LogQuery.provisional) until this run's backfill has covered [deployBlock, finalizedTo]; then
   * `onOutcome` is told whether it matched, and it is dropped either way. False (and nothing
   * changes) when a history was seeded before, the index is closed, or the seed's last block is
   * below the first block. Logs must have been checked (parseLogs) against this index's filter.
   */
  seedProvisional(
    seed: ProvisionalSeed,
    onOutcome?: (outcome: ProvisionalOutcome) => void
  ): boolean;
  /** Drops a seeded history still awaiting verification (its outcome is not reported). */
  dropProvisional(): void;
  /** The complete final history once the backfill has covered it, else null. */
  finalSnapshot(): FinalSnapshot | null;
  /** Drops everything; later results are discarded and queries fail. */
  close(): void;
}

/**
 * Whether a history from the last run may still be seeded (the chain cache is being loaded): a
 * page's read that allows one waits for it, at most `SEED_WAIT_MS`, instead of deciding without
 * it. Settles when the seed is in place, or will not come.
 */
export class SeedExpectation {
  #pending: Promise<void> | null = null;

  /** A seed may come until `until` settles. */
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

  /** Whether a seed may still come. */
  get pending(): boolean {
    return this.#pending !== null;
  }

  /** Resolves once no seed is expected any more, or after `ms`. */
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

/** The longest a page's read waits for the chain cache to be loaded before reading without it. */
export const SEED_WAIT_MS = 2_000;

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
// The bridge above a seeded history (see fromSeeded) is read on its own only when it spans at most
// this many pieces of the index's span (10,000 blocks while none is known: Infura's cap). A wider
// gap (a file from weeks ago) is left to the backfill, which reads the newest blocks first anyway:
// a page then waits for it to cover the gap, instead of the gap being read twice, the second time
// on the quick lane beside verdict calls.
export const BRIDGE_MAX_CHUNKS = 8n;
const BRIDGE_DEFAULT_SPAN = 10_000n;
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

/** The addresses (and topic0 values, when the index names them) a log must match. */
export type LogFilterShape = { addresses: readonly Address[]; topic0?: readonly Hex[] | null };

type FilterKeys = { addresses: ReadonlySet<string>; topics: ReadonlySet<string> | null };

const filterKeys = ({ addresses, topic0 }: LogFilterShape): FilterKeys => ({
  addresses: new Set(addresses.map((a) => a.toLowerCase())),
  topics: topic0 ? new Set(topic0.map((t) => t.toLowerCase())) : null,
});

/**
 * An eth_getLogs answer for [from, to] under `filter`, checked as the index checks every answer:
 * a list of mined logs (none removed), each from a filtered address (and topic0), with its
 * block, index, hashes and data, inside the range, and no log twice. Ordered by (block, index).
 * Throws InvalidLogsAnswer. For logs from anywhere else too (a history saved by a previous run).
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

/** Splits [from, to] into ranges of at most `span` blocks, newest first. */
export function chunksOf(range: Range, span: bigint): Range[] {
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
  // One address is sent as a string (as before), several as eth_getLogs' OR-list. A topic0 list
  // goes in position 0; without one there is no `topics` key at all.
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

  // A history seeded from the last run (see ProvisionalSeed), while it awaits verification and
  // after (its outcome, for status). `bridge`: this run's read of the final blocks between its
  // last block and this run's boundary when the read started (`to`, never below the seeded last
  // block), for pages that read the seeded history; a page reads what is above it at the same
  // time. Only for a narrow gap (see BRIDGE_MAX_CHUNKS).
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
    // Read the blocks between a seeded history and this run's coverage now, beside the backfill's
    // first requests, so a page can answer from the seeded history without waiting for it.
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

  // ---- eth_getLogs ----

  /**
   * All logs in [from, to], checked (see checkLogs). A log already in the final range is a
   * duplicate, unless `apart` (a read kept beside the final range: the bridge above a seeded
   * history, which the backfill may cover meanwhile).
   */
  async function getLogs(
    from: bigint,
    to: bigint,
    apart = false,
    via: Lane = lane
  ): Promise<IndexedLog[]> {
    // Address only (no `topics` key at all), unless the index names its topic0 values.
    const raw = await via.request<unknown>("eth_getLogs", [
      { ...filter, fromBlock: numberToHex(from), toBlock: numberToHex(to) },
    ]);
    return checkLogs(raw, keys, from, to, apart ? null : finalKeys);
  }

  /**
   * An explicit cap ("range N exceeds limit of M") is the provider's own limit: it becomes the
   * index's span, replacing one learned by halving, and only a smaller cap lowers it again.
   */
  function adoptCap(cap: bigint) {
    if (spanIsCap && span !== null && span <= cap) return;
    span = cap;
    spanIsCap = true;
    if (current()) options.onCap?.(cap);
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

  /** Waits before retry number `attempt` (1-based), as a backfill chunk does. */
  const backoff = (attempt: number) =>
    new Promise((resolve) => setTimeout(resolve, retryDelayMs * attempt));

  /**
   * All logs in [from, to] (used for heads and their gaps, and the bridge above a seeded
   * history), in pieces of at most `limit` blocks, through the quick lane until the history is
   * complete.
   * A range error splits this read only; the index-wide span changes only for an explicit cap.
   * Any other failure (or a range error that cannot be split further) is retried like a backfill
   * chunk, `chunkRetries` times with backoff, before the read fails.
   */
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
      // Never in a POST with the backfill's chunks: until the history is complete, through the
      // quick lane.
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
    if (!moved) return;
    notify();
    checkSeeded();
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
   * `minSpan`: an RPC that refuses even that serves no usable history, as in logs.ts. A failure
   * that is not about the range is retried like a backfill chunk (`chunkRetries` times, with
   * backoff) before the backfill fails: on a provider without a cap this request is the whole
   * backfill.
   */
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
    // Never paced, whoever started it (sync/pacer.ts): the engine's index step can start a
    // backfill, which is not the engine's per-block work.
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

  // ---- heads ----

  let chain: Promise<unknown> = Promise.resolve();
  // The reads for the last few heads. A query answers from the read for its own head, and the
  // sync engine reads a new head's tail before it serves that head: queries at the head still
  // served meanwhile keep theirs instead of reading it again.
  const recentSyncs = new Map<string, Promise<Tail>>();
  const RECENT_HEADS = 4;

  /**
   * Reads (finalizedTo, head] once per head (number and hash); the part at or below the new
   * boundary is promoted to final from this fresh read. Resolves with the read, which is what a
   * query at this head answers from: a later read at another (even an older) head never stands
   * in for it. Reads run one at a time.
   */
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
    // A seeded history whose last block was above the boundary when the backfill completed is
    // checked once the boundary reaches it.
    checkSeeded();
    return read;
  }

  // ---- a history seeded from the last run ----

  /** Tells the seeded history's outcome to whoever seeded it. */
  function report(entry: Seeded, outcome: ProvisionalOutcome) {
    try {
      entry.onOutcome?.(outcome);
    } catch {
      // The listener's failure is its own.
    }
  }

  /**
   * Once this run's backfill covers the seeded history's whole range, compares the two: the same
   * logs, each saying the same thing, is "verified"; anything else (a log added, removed or
   * changed) is a "mismatch". Either way the seeded logs are dropped: this run's are complete.
   */
  function checkSeeded() {
    const entry = seeded;
    if (!entry || entry.state !== "provisional" || !complete() || top < entry.finalizedTo) return;
    const fresh = final.filter((log) => log.blockNumber <= entry.finalizedTo);
    entry.state = sameLogs(fresh, entry.logs) ? "verified" : "mismatch";
    entry.logs = [];
    entry.bridge = null;
    report(entry, entry.state);
  }

  /**
   * Whether the blocks between the seeded history and this run's boundary are read on their own
   * (a bridge): only once the boundary has reached the seeded last block (a read from below it
   * would leave part of this run's range to be read twice), and only for a narrow gap.
   */
  function bridgeable(entry: Seeded): boolean {
    if (top < entry.finalizedTo) return false;
    return top - entry.finalizedTo <= (span ?? BRIDGE_DEFAULT_SPAN) * BRIDGE_MAX_CHUNKS;
  }

  /**
   * This run's read of (seeded last block, this run's boundary now]: final blocks. Only when
   * bridgeable(entry).
   */
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
    // Already covered by this run (the seed came late): checked now.
    checkSeeded();
    if (entry.state === "provisional" && anchored && bridgeable(entry)) startBridge(entry);
    return true;
  }

  /**
   * A page's answer from the seeded history (LogQuery.provisional): the seeded logs up to its last
   * block, this run's bridge read above it (a narrow gap only), and this run's final range and
   * tail above that (for a wider gap, once the newest-first backfill has covered it). null when
   * the answer should not come from there (no history awaiting verification, the backfill
   * already covers `fromBlock`, the history claims final blocks above the boundary at this head,
   * `fromBlock` is above the seeded history and no bridge stands in for the backfill, or the
   * bridge read failed): the query then reads as any other.
   */
  async function fromSeeded(query: LogQuery & { head: IndexHead }): Promise<IndexRead | null> {
    const entry = seeded;
    const observed = query.head;
    const from = max(query.fromBlock ?? deployBlock, deployBlock);
    if (!entry || entry.state !== "provisional" || covers(from)) return null;
    if (entry.finalizedTo > observed.safe || entry.finalizedTo > top) return null;
    // A bridge that ends below the seeded last block would make this run's reads above it
    // overlap the seeded logs (startBridge never makes one; never use one).
    if (entry.bridge && entry.bridge.to < entry.finalizedTo) entry.bridge = null;
    const bridge = entry.bridge ?? (bridgeable(entry) ? startBridge(entry) : null);
    // Nothing of the last run's is asked for, and nothing read on its own is faster: as any query.
    if (!bridge && from > entry.finalizedTo) return null;
    if (!complete() && !recentFailure()) void startBackfill();
    const upper = query.toBlock ?? observed.head.number;
    // Above the seeded history and the bridge, read at the same time: this run's coverage and
    // tail. Directly above the bridge that is already answerable (the bridge ends at a boundary
    // this run reached); without a bridge, it waits for the backfill to cover the gap.
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
      // After a failure, report it for a while instead of hammering the RPC; then resume.
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
    label,
    addresses,
    deployBlock,
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
