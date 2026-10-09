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

const engineWork = new AsyncLocalStorage<boolean>();

/** Runs `work` as the sync engine's own (paced) work. */
export function asEngineWork<T>(work: () => T): T {
  return engineWork.run(true, work);
}

/** Runs `work` as a request's (never paced), e.g. a backfill the engine happened to start. */
export function asRequestWork<T>(work: () => T): T {
  return engineWork.run(false, work);
}

/** Whether the code running now is the sync engine's own work (see asEngineWork). */
export function isEngineWork(): boolean {
  return engineWork.getStore() === true;
}

/** Infura's published credit weight of one JSON-RPC request (an estimate for other providers). */
export function creditsOf(method: string): number {
  if (method === "eth_getLogs") return 255;
  if (method === "eth_chainId") return 5;
  return 80;
}

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
};

const WINDOW_MS = 1_000;

type Waiter = { credits: number; resolve: () => void; since: number };

/**
 * A sliding one-second window of credits: take(c) resolves once c more credits keep the last
 * second's total within the rate (at once when they do; null then, so the caller need not wait a
 * turn of the event loop). A take larger than the whole rate goes out alone in an empty second.
 * Waiters go in order.
 */
export class CreditPacer {
  readonly #rate: () => number;
  readonly #now: () => number;
  #sent: { at: number; credits: number }[] = [];
  #waiting: Waiter[] = [];
  #timer: ReturnType<typeof setTimeout> | null = null;
  #peak = 0;
  #waited = 0;
  #maxWaitMs = 0;
  #expedited = 0;
  // Requests waiting on the engine's work now: while any does, nothing waits here.
  #hurry = 0;

  constructor(rate: number | (() => number), now: () => number = Date.now) {
    this.#rate = typeof rate === "function" ? rate : () => rate;
    this.#now = now;
  }

  /** Waits (when needed) until `credits` more fit in the last second, then counts them. */
  take(credits: number): Promise<void> | null {
    const rate = this.#rate();
    if (!(rate > 0) || !(credits > 0)) return null;
    if (this.#hurry > 0) {
      this.#expedited++;
      this.#count(credits);
      return null;
    }
    if (this.#waiting.length === 0 && this.#fits(credits, rate)) {
      this.#count(credits);
      return null;
    }
    return new Promise<void>((resolve) => {
      this.#waiting.push({ credits, resolve, since: this.#now() });
      this.#arm();
    });
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
    while (this.#waiting.length > 0) {
      const next = this.#waiting[0] as Waiter;
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
let instance: CreditPacer | null = null;

/** Where the pacer reads SYNC_CREDITS_PER_SECOND from (the sync engine, at its start). */
export function readRateFrom(read: () => number) {
  rate = read;
}

/** The process's pacer for engine work. */
export function pacer(): CreditPacer {
  instance ??= new CreditPacer(() => rate());
  return instance;
}

/**
 * For a lane or the head follower: the wait (null: none) before sending a request of `method`
 * when the code running is the engine's own work; null for a request's.
 */
export function paceEngineRequest(method: string): Promise<void> | null {
  return isEngineWork() ? pacer().take(creditsOf(method)) : null;
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
