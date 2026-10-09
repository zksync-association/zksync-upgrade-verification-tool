import { AsyncLocalStorage } from "node:async_hooks";

// The pace of the sync engine's own upstream work, in Infura's credit weights: a free Infura key
// allows 500 credits a second, and every JSON-RPC request costs credits (eth_getLogs 255,
// eth_chainId 5, every other method the app sends 80; each entry of a batch counts). The engine's
// reads (head polls, the index tail, the per-block aggregate3, re-asks) wait here so that at most
// SYNC_CREDITS_PER_SECOND credits of them go out in any one second; a request's own reads never
// wait (and do not count), nor does the start's history backfill. A read the engine shares with a
// request (one Multicall3 call both added to, a head read both joined) goes out as a request's.
//
// "Engine work" is whatever runs inside asEngineWork(), followed through its asynchronous
// continuations (AsyncLocalStorage). Nothing here sends anything or keeps a timer beyond a wait
// that someone is awaiting. While a request waits on the engine's work (a read both share, kept
// in cache.ts while in flight; a signature set the engine is verifying), the engine's work goes
// unpaced (hurry): a request is never held up by the engine's pace.
//
// The engine's work goes out only while the engine may send (allowEngineWorkWhen, set by
// sync/engine.ts: someone uses the app or the engine follows the chain, under the settings it was
// asked under). Engine work that would wait while it may not, or whose wait ends once it may no
// longer (use ended, the engine paused or stopped, the settings changed), is never sent: its wait
// rejects with EngineWorkDropped (R-D3: nothing is read once use has ended). A wait a request
// hurried along is a request's, and always goes. The engine's work remembers the settings
// generation it started under: none of it goes out under later settings, a retry of a request
// dropped here (viem retries unknown errors) included.

// The settings generation the engine's work started under (asEngineWork); false for a request's.
const engineWork = new AsyncLocalStorage<number | false>();

/**
 * Runs `work` as the sync engine's own (paced) work, under the settings generation now (or the one
 * the engine's work around it started under).
 */
export function asEngineWork<T>(work: () => T): T {
  const outer = engineWork.getStore();
  return engineWork.run(typeof outer === "number" ? outer : sendRule.generation(), work);
}

/** Runs `work` as a request's (never paced), e.g. a backfill the engine happened to start. */
export function asRequestWork<T>(work: () => T): T {
  return engineWork.run(false, work);
}

/** Whether the code running now is the sync engine's own work (see asEngineWork). */
export function isEngineWork(): boolean {
  return typeof engineWork.getStore() === "number";
}

/** Infura's published credit weight of one JSON-RPC request (an estimate for other providers). */
export function creditsOf(method: string): number {
  if (method === "eth_getLogs") return 255;
  if (method === "eth_chainId") return 5;
  return 80;
}

/**
 * The engine's work was not sent: it waited its turn and, by then, the engine could no longer send
 * (see the top). Not a failure of the data source.
 */
export class EngineWorkDropped extends Error {
  override name = "EngineWorkDropped";
}

/** When the engine's own work may be sent (see the top). */
export type EngineSendRule = {
  /** Whether it may be sent now. */
  allowed: () => boolean;
  /** The settings generation now: work that waited across a settings change is never sent. */
  generation: () => number;
};

const ALWAYS: EngineSendRule = { allowed: () => true, generation: () => 0 };

export type PacerStatus = {
  /** Credits a second the engine's work may use (0: unpaced). */
  creditsPerSecond: number;
  /** Credits of engine work sent in the last second. */
  lastSecond: number;
  /** The most credits of engine work sent in any one second so far (sliding window). */
  peakPerSecond: number;
  /** Engine requests that had to wait, and the longest wait (ms). */
  waited: number;
  maxWaitMs: number;
  /** Engine requests waiting now. */
  queued: number;
  /** Engine requests let go unpaced because a request waited on the engine's work. */
  expedited: number;
  /** Engine requests never sent: the engine could no longer send when their turn came. */
  dropped: number;
};

const WINDOW_MS = 1_000;

type Waiter = {
  credits: number;
  resolve: () => void;
  reject: (error: Error) => void;
  since: number;
  /** The settings generation it was asked under. */
  generation: number;
};

/**
 * A sliding one-second window of credits: take(c) resolves once c more credits keep the last
 * second's total within the rate (at once when they do; null then, so the caller need not wait a
 * turn of the event loop). A take larger than the whole rate goes out alone in an empty second.
 * Waiters go in order. While `rule` does not allow the engine to send, a take rejects at once,
 * and a waiter whose turn comes then (or whose settings generation passed) rejects instead of
 * going (EngineWorkDropped); so does a take for work started under other settings, hurried or
 * not. drop() rejects every waiter now.
 */
export class CreditPacer {
  readonly #rate: () => number;
  readonly #now: () => number;
  readonly #rule: () => EngineSendRule;
  #sent: { at: number; credits: number }[] = [];
  #waiting: Waiter[] = [];
  #timer: ReturnType<typeof setTimeout> | null = null;
  #peak = 0;
  #waited = 0;
  #maxWaitMs = 0;
  #expedited = 0;
  #dropped = 0;
  // Requests waiting on the engine's work now: while any does, nothing waits here.
  #hurry = 0;

  constructor(
    rate: number | (() => number),
    now: () => number = Date.now,
    rule: () => EngineSendRule = () => ALWAYS
  ) {
    this.#rate = typeof rate === "function" ? rate : () => rate;
    this.#now = now;
    this.#rule = rule;
  }

  /**
   * Waits (when needed) until `credits` more fit in the last second, then counts them. `started`:
   * the settings generation the work was started under (default: the current one); work started
   * under other settings is never sent.
   */
  take(credits: number, started?: number): Promise<void> | null {
    const rate = this.#rate();
    if (!(rate > 0) || !(credits > 0)) return null;
    const rule = this.#rule();
    const generation = started ?? rule.generation();
    if (generation !== rule.generation()) {
      this.#dropped++;
      return Promise.reject(dropped());
    }
    if (this.#hurry > 0) {
      this.#expedited++;
      this.#count(credits);
      return null;
    }
    if (!rule.allowed()) {
      this.#dropped++;
      return Promise.reject(dropped());
    }
    if (this.#waiting.length === 0 && this.#fits(credits, rate)) {
      this.#count(credits);
      return null;
    }
    return new Promise<void>((resolve, reject) => {
      this.#waiting.push({ credits, resolve, reject, since: this.#now(), generation });
      this.#arm();
    });
  }

  /**
   * Rejects every waiting engine request now (EngineWorkDropped): the engine paused or stopped,
   * so none of them is sent (R-D3).
   */
  drop() {
    if (this.#waiting.length === 0) return;
    const waiting = this.#waiting;
    this.#waiting = [];
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
    for (const waiter of waiting) {
      this.#dropped++;
      waiter.reject(dropped());
    }
  }

  /** Counts credits sent without waiting (they still hold up later takes). */
  debit(credits: number) {
    if (credits > 0 && this.#rate() > 0) this.#count(credits);
  }

  /**
   * A request waits on the engine's work until `settled` settles: until then the engine's
   * requests go at once (those waiting now too).
   */
  hurry(settled: Promise<unknown>) {
    this.#hurry++;
    const done = () => {
      this.#hurry--;
    };
    settled.then(done, done);
    this.expedite();
  }

  /** Lets every waiting engine request go now. */
  expedite() {
    if (this.#waiting.length === 0) return;
    const waiting = this.#waiting;
    this.#waiting = [];
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
    for (const waiter of waiting) {
      this.#expedited++;
      this.#count(waiter.credits);
      waiter.resolve();
    }
  }

  status(): PacerStatus {
    const now = this.#now();
    this.#prune(now);
    return {
      creditsPerSecond: Math.max(0, this.#rate()),
      lastSecond: this.#total(),
      peakPerSecond: this.#peak,
      waited: this.#waited,
      maxWaitMs: this.#maxWaitMs,
      queued: this.#waiting.length,
      expedited: this.#expedited,
      dropped: this.#dropped,
    };
  }

  /** Forgets everything; waiters go at once (tests, settings changes). */
  reset() {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
    const waiting = this.#waiting;
    this.#waiting = [];
    this.#sent = [];
    this.#peak = 0;
    this.#waited = 0;
    this.#maxWaitMs = 0;
    this.#expedited = 0;
    this.#dropped = 0;
    this.#hurry = 0;
    for (const waiter of waiting) waiter.resolve();
  }

  #prune(now: number) {
    while (this.#sent.length > 0 && now - (this.#sent[0] as { at: number }).at >= WINDOW_MS)
      this.#sent.shift();
  }

  #total(): number {
    let sum = 0;
    for (const entry of this.#sent) sum += entry.credits;
    return sum;
  }

  #fits(credits: number, rate: number): boolean {
    this.#prune(this.#now());
    const total = this.#total();
    // One request larger than the whole rate goes out alone.
    return total === 0 || total + credits <= rate;
  }

  #count(credits: number) {
    const now = this.#now();
    this.#sent.push({ at: now, credits });
    this.#peak = Math.max(this.#peak, this.#total());
  }

  #arm() {
    if (this.#timer) return;
    const first = this.#sent[0];
    const wait = first ? Math.max(1, first.at + WINDOW_MS - this.#now()) : 1;
    const timer = setTimeout(() => {
      this.#timer = null;
      this.#drain();
    }, wait);
    (timer as { unref?: () => void }).unref?.();
    this.#timer = timer;
  }

  #drain() {
    const rate = this.#rate();
    const rule = this.#rule();
    while (this.#waiting.length > 0) {
      const next = this.#waiting[0] as Waiter;
      // Its turn came once the engine could no longer send it: never sent.
      if (!rule.allowed() || rule.generation() !== next.generation) {
        this.#waiting.shift();
        this.#dropped++;
        next.reject(dropped());
        continue;
      }
      if (rate > 0 && !this.#fits(next.credits, rate)) break;
      this.#waiting.shift();
      const waitedMs = this.#now() - next.since;
      this.#waited++;
      this.#maxWaitMs = Math.max(this.#maxWaitMs, waitedMs);
      if (rate > 0) this.#count(next.credits);
      next.resolve();
    }
    if (this.#waiting.length > 0) this.#arm();
  }
}

// SYNC_CREDITS_PER_SECOND, as the sync engine reads it from the environment (readRateFrom). This
// module reads no environment itself.
const DEFAULT_CREDITS_PER_SECOND = 450;
let rate: () => number = () => DEFAULT_CREDITS_PER_SECOND;
// Unset (no engine in this process, e.g. a script): the engine's work may always be sent.
let sendRule: EngineSendRule = ALWAYS;
let instance: CreditPacer | null = null;

/** Where the pacer reads SYNC_CREDITS_PER_SECOND from (the sync engine, at its start). */
export function readRateFrom(read: () => number) {
  rate = read;
}

/** When the engine's own work may be sent (sync/engine.ts; see the top); returns the last rule. */
export function allowEngineWorkWhen(rule: EngineSendRule): EngineSendRule {
  const previous = sendRule;
  sendRule = rule;
  return previous;
}

/** The process's pacer for engine work. */
export function pacer(): CreditPacer {
  instance ??= new CreditPacer(
    () => rate(),
    Date.now,
    () => sendRule
  );
  return instance;
}

function dropped(): EngineWorkDropped {
  return new EngineWorkDropped(
    "Not sent: the sync engine could no longer send it (use ended, or the settings changed)"
  );
}

/**
 * For a lane or the head follower: the wait (null: none) before sending a request of `method`
 * when the code running is the engine's own work; null for a request's.
 */
export function paceEngineRequest(method: string): Promise<void> | null {
  const started = engineWork.getStore();
  return typeof started === "number" ? pacer().take(creditsOf(method), started) : null;
}

/**
 * For a client only the engine's own work uses (rpc.ts): every request it sends is the engine's,
 * however it was scheduled (a Multicall3 batch's timer, a retry).
 */
export function paceAsEngine(method: string): Promise<void> | null {
  const started = engineWork.getStore();
  return pacer().take(creditsOf(method), typeof started === "number" ? started : undefined);
}

/**
 * For a request about to wait on `settled`, work the engine started (a shared read in flight):
 * until it settles the engine's requests go unpaced, so the request is not held up by the
 * engine's pace. Nothing for the engine's own work.
 */
export function requestJoinsEngineWork(settled: Promise<unknown>) {
  if (!isEngineWork()) pacer().hurry(settled);
}

/** Starts the pacer afresh (tests). */
export function resetPacer() {
  instance?.reset();
  instance = null;
}
