import { AsyncLocalStorage } from "node:async_hooks";

// Paces the sync engine's own upstream work (whatever runs inside asEngineWork, followed through
// AsyncLocalStorage) to SYNC_CREDITS_PER_SECOND Infura credits a second. A request's own reads
// never wait or count, nor does the start's backfill; a read shared with a request goes out as a
// request's. While a request waits on engine work, that work goes unpaced (hurry): a request is
// never held up by the engine's pace. Engine work goes out only while the engine may send
// (allowEngineWorkWhen) and under the settings generation it started under; otherwise it is
// dropped (EngineWorkDropped), never sent: nothing is read once use has ended, unpaced or hurried
// alike, viem's retries included.

// The settings generation the engine's work started under (asEngineWork); false for a request's.
const engineWork = new AsyncLocalStorage<number | false>();

export function asEngineWork<T>(work: () => T): T {
  const outer = engineWork.getStore();
  return engineWork.run(typeof outer === "number" ? outer : sendRule.generation(), work);
}

export function asRequestWork<T>(work: () => T): T {
  return engineWork.run(false, work);
}

export function isEngineWork(): boolean {
  return typeof engineWork.getStore() === "number";
}

/** Infura's published credit weight of one JSON-RPC request (an estimate for other providers). */
export function creditsOf(method: string): number {
  if (method === "eth_getLogs") return 255;
  if (method === "eth_chainId") return 5;
  return 80;
}

/** Engine work not sent because the engine could no longer send it: not a data source failure. */
export class EngineWorkDropped extends Error {
  override name = "EngineWorkDropped";
}

export type EngineSendRule = {
  allowed: () => boolean;
  generation: () => number;
};

const ALWAYS: EngineSendRule = { allowed: () => true, generation: () => 0 };

export type PacerStatus = {
  /** 0: unpaced. */
  creditsPerSecond: number;
  lastSecond: number;
  peakPerSecond: number;
  waited: number;
  maxWaitMs: number;
  queued: number;
  /** Engine requests let go unpaced because a request waited on the engine's work. */
  expedited: number;
  dropped: number;
};

const WINDOW_MS = 1_000;

type Waiter = {
  credits: number;
  resolve: () => void;
  reject: (error: Error) => void;
  since: number;
  generation: number;
};

// A sliding one-second window of credits. take() returns null when they fit now (the caller need
// not wait a turn of the event loop); waiters go in order and are dropped (EngineWorkDropped),
// never sent, once the send rule no longer allows them, at any rate (0 included) and while hurried.
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

  take(credits: number, started?: number): Promise<void> | null {
    const rule = this.#rule();
    const generation = started ?? rule.generation();
    // Before any pacing: at rate 0 and while hurried too, engine work goes only while it may.
    if (!mayGo(rule, generation)) {
      this.#dropped++;
      return Promise.reject(dropped());
    }
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
    return new Promise<void>((resolve, reject) => {
      this.#waiting.push({ credits, resolve, reject, since: this.#now(), generation });
      this.#arm();
    });
  }

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

  hurry(settled: Promise<unknown>) {
    this.#hurry++;
    const done = () => {
      this.#hurry--;
    };
    settled.then(done, done);
    this.expedite();
  }

  expedite() {
    if (this.#waiting.length === 0) return;
    const waiting = this.#waiting;
    this.#waiting = [];
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
    const rule = this.#rule();
    for (const waiter of waiting) {
      if (!mayGo(rule, waiter.generation)) {
        this.#dropped++;
        waiter.reject(dropped());
        continue;
      }
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
      if (!mayGo(rule, next.generation)) {
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

// The engine supplies SYNC_CREDITS_PER_SECOND (readRateFrom): this module reads no environment.
const DEFAULT_CREDITS_PER_SECOND = 450;
let rate: () => number = () => DEFAULT_CREDITS_PER_SECOND;
// Unset (no engine in this process, e.g. a script): the engine's work may always be sent.
let sendRule: EngineSendRule = ALWAYS;
let instance: CreditPacer | null = null;

export function readRateFrom(read: () => number) {
  rate = read;
}

export function allowEngineWorkWhen(rule: EngineSendRule): EngineSendRule {
  const previous = sendRule;
  sendRule = rule;
  return previous;
}

export function pacer(): CreditPacer {
  instance ??= new CreditPacer(
    () => rate(),
    Date.now,
    () => sendRule
  );
  return instance;
}

function mayGo(rule: EngineSendRule, generation: number): boolean {
  return rule.generation() === generation && rule.allowed();
}

function dropped(): EngineWorkDropped {
  return new EngineWorkDropped(
    "Not sent: the sync engine could no longer send it (use ended, or the settings changed)"
  );
}

export function paceEngineRequest(method: string): Promise<void> | null {
  const started = engineWork.getStore();
  return typeof started === "number" ? pacer().take(creditsOf(method), started) : null;
}

// For a client only the engine's own work uses (rpc.ts): every request it sends is the engine's,
// however it was scheduled (a Multicall3 batch's timer, a retry).
export function paceAsEngine(method: string): Promise<void> | null {
  const started = engineWork.getStore();
  return pacer().take(creditsOf(method), typeof started === "number" ? started : undefined);
}

export function requestJoinsEngineWork(settled: Promise<unknown>) {
  if (!isEngineWork()) pacer().hurry(settled);
}

export function resetPacer() {
  instance?.reset();
  instance = null;
}
