import { defaultLogger } from "@config/log.server";
import { env } from "@config/env.server";
import type { Address, Hex } from "viem";
import { cached, remainingMs, replace } from "../cache";
import { allowPinChecksWhen } from "../chain/pins";
import { puhIndex } from "../chain/puh-index";
import {
  GOVERNANCE_KEY,
  GOVERNANCE_TTL_MS,
  type Governance,
  SAFE_INFO_TTL_MS,
  governance,
  governanceSplitApplies,
  readGovernance,
  readSafeInfo,
  safeInfo,
  safeInfoKey,
} from "../governance";
import {
  type BlockRef,
  type Network,
  type PolledHead,
  network,
  pollHead,
  resolvedNetwork,
  rpcGeneration,
  servedHead,
} from "../rpc";
import {
  type SafeCheck,
  type SafeWatchDriver,
  type WatchedSafe,
  nudgeSafeWatch,
  safeBurst,
  safeCheckOf,
  startSafeWatch,
  stopSafeWatch,
} from "../safe/store";
import {
  type SignatureWatchDriver,
  onScreenSigners,
  pageSetOf,
  precomputeSignatureSets,
  resimulateOnScreen,
  startSignatureWatch,
  stopSignatureWatch,
  watchedSetMembers,
} from "../signatures";
import { type RequestInfo, isL2Key, isPageLoad, presence, readKeepWarmFrom } from "./presence";
import { type UpstreamCost, upstreamCost } from "./cost";
import { noteOnScreenContent } from "./content-engine";
import { startEraWatch, stopEraWatch } from "./era";
import { pageGovernance } from "../page-governance";
import { allowEngineWorkWhen, asEngineWork, creditsOf, pacer, readRateFrom } from "./pacer";
import { snapshotState, snapshotStep } from "./snapshot";

// The sync engine follows the chain head while someone uses the app (presence.ts) and, at each new
// block, refills the cache entries requests read (head, index tail, upgrade states, the Safe info
// and signature sets on screen), reading what changes AT that block in as few calls as possible.
// It never answers by itself: stopped, failing or off, requests read on demand within the same
// bounds (head 4 s, governance 30 s). A new head is served once what requests need at it is in
// memory, at most 2 s after it was seen. Nothing here logs an error's text: it can carry the RPC
// URL and its key.

export type SyncMode = "window" | "off";

export type SyncEngineStatus = {
  mode: SyncMode;
  reason: string | null;
  active: boolean;
  head: {
    number: string;
    hash: Hex;
    observedAt: string;
    confirmedAt: string;
    servedAt: string | null;
    ageMs: number;
  } | null;
  lastTick: { block: string; ms: number; failedSteps: string[] } | null;
  polls: number;
  ticks: number;
  cost: UpstreamCost & {
    mode: "viewing" | "idle";
    pacer: ReturnType<ReturnType<typeof pacer>["status"]>;
  };
  clock: HeadClockStatus;
};

export type HeadClockStatus = {
  headPoll: "slot";
  rttP95Ms: number | null;
  recent: {
    blocks: number;
    pollsPerBlock: number | null;
    /** From the block's timestamp to the poll answer that showed it. */
    seenOffsetMs: Spread | null;
    /** From the poll answer that showed it to when requests started to read it. */
    servedDelayMs: Spread | null;
    /** From the block's timestamp to when requests started to read it. */
    servedOffsetMs: Spread | null;
  };
};

export type Spread = { p50: number; p80: number; max: number };

export type Tick = {
  head: BlockRef;
  generation: number;
  /** The engine still runs for these settings, and someone is using the app now. */
  inUse(): boolean;
  boundary(): Promise<bigint>;
  current(): boolean;
  /** true once the head was served; false when it never will be (replaced, or engine stopped). */
  served(): Promise<boolean>;
};

export type TickStep = {
  name: string;
  run: (tick: Tick) => Promise<void>;
  /** The new head is served only after this step (and the others like it) settled. */
  beforePublish?: boolean;
};

/** A step that had nothing to do this time (not a failure). */
export class StepSkipped extends Error {
  override name = "StepSkipped";
}

export type SyncEngineOptions = {
  mode: SyncMode;
  inUse: () => boolean;
  generation: number;
  now?: () => number;
  currentGeneration: () => number;
  network: () => Promise<Pick<Network, "isDevNode" | "name" | "blockTimeSeconds">>;
  pollHead: (options: { withFinalized: boolean }) => Promise<PolledHead>;
  steps: readonly TickStep[];
  onSuperseded?: () => void;
  /** The credit pacer's wait before a head poll, waited before the read so no request joins it. */
  pacePoll?: (withFinalized: boolean) => Promise<void> | null;
};

// On a chain with fixed slots, block N+1 cannot exist before N's timestamp plus one slot: until
// then N is re-confirmed without asking the node (once the local clock is shown not to run behind,
// see #observe); from then on the node is asked every second, every 2 s once a slot was missed.
const CONFIRM_EVERY_MS = 2_000;
const SLOT_POLL_MS = 1_000;
const POLL_MS = 2_000;
// The slot schedule applies to a head seen between 0 and two slots after its own timestamp.
const MAX_SKEW_MS = 24_000;
// After a sign that the local clock runs behind, heads are confirmed only by the node this long.
const CLOCK_DISTRUST_MS = 10 * 60_000;
// 'finalized' is asked again every 32 blocks, before the tail above it would pass 128 blocks, and
// after a gap (idle, failing): the head may have moved any distance.
const FINALIZED_EVERY = 32n;
const MAX_TAIL = 128n;
const FINALIZED_AFTER_GAP_MS = 60_000;
const PUBLISH_WITHIN_MS = 2_000;

type Observation = {
  seq: number;
  polled: PolledHead;
  observedAt: number;
  confirmedAt: number;
  nextSlotAt: number | null;
  /** Until nextSlotAt the head is re-confirmed without asking the node (see #observe). */
  slotConfirm: boolean;
  pollsAtSeen: number;
  published: boolean;
  servedAt: number | null;
  deadline: ReturnType<typeof setTimeout> | null;
  served: Promise<boolean>;
  resolveServed: (served: boolean) => void;
};

type PollRecord = { sentAt: number; hash: Hex; timestampMs: number };

type Run = {
  observation: Observation;
  tick: Tick;
  started: number;
  open: number;
  waiting: number;
  ran: number;
  failed: Map<number, string>;
};

/** One step's runs, one head at a time; only the newest head waiting runs next. */
type Lane = { running: Promise<void> | null; queued: Run | null };

const log = defaultLogger.child({ module: "sync" });

/** A class name such as "HttpRequestError", never the error's text. */
function errorKind(error: unknown): string {
  const name = error instanceof Error ? error.name : typeof error;
  return /^[A-Za-z]\w{0,63}$/.test(name) ? name : "Error";
}

const KEEP_SAMPLES = 32;
const KEEP_RECENT = 64;

function quantile(values: readonly number[], q: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))] ?? 0;
}

function spread(values: readonly number[]): Spread | null {
  if (values.length === 0) return null;
  return {
    p50: Math.round(quantile(values, 0.5)),
    p80: Math.round(quantile(values, 0.8)),
    max: Math.round(Math.max(...values)),
  };
}

const keepLast = <T>(list: T[], item: T, limit: number) => {
  list.push(item);
  if (list.length > limit) list.splice(0, list.length - limit);
};

class HeadClock {
  readonly #rtts: number[] = [];
  readonly #recent: {
    number: bigint;
    timestampMs: number;
    seenOffsetMs: number;
    polls: number | null;
    servedDelayMs: number | null;
    servedOffsetMs: number | null;
  }[] = [];

  noteRtt(ms: number) {
    if (ms >= 0) keepLast(this.#rtts, ms, KEEP_SAMPLES);
  }

  noteSeen(
    head: BlockRef,
    previous: { head: BlockRef; pollsAtSeen: number } | null,
    now: number,
    polls: number
  ) {
    const timestampMs = Number(head.timestamp) * 1000;
    const next = previous !== null && head.number === previous.head.number + 1n;
    if (next)
      keepLast(
        this.#recent,
        {
          number: head.number,
          timestampMs,
          seenOffsetMs: now - timestampMs,
          polls: polls - previous.pollsAtSeen,
          servedDelayMs: null,
          servedOffsetMs: null,
        },
        KEEP_RECENT
      );
  }

  noteServed(head: BlockRef, observedAt: number, servedAt: number) {
    const entry = this.#recent.find((r) => r.number === head.number);
    if (!entry || entry.servedDelayMs !== null) return;
    entry.servedDelayMs = servedAt - observedAt;
    entry.servedOffsetMs = servedAt - entry.timestampMs;
  }

  status(): HeadClockStatus {
    const polls = this.#recent.flatMap((r) => (r.polls === null ? [] : [r.polls]));
    const served = this.#recent.flatMap((r) => (r.servedDelayMs === null ? [] : [r]));
    return {
      headPoll: "slot",
      rttP95Ms: this.#rtts.length > 0 ? Math.round(quantile(this.#rtts, 0.95)) : null,
      recent: {
        blocks: this.#recent.length,
        pollsPerBlock:
          polls.length > 0
            ? Math.round((polls.reduce((a, b) => a + b, 0) / polls.length) * 100) / 100
            : null,
        seenOffsetMs: spread(this.#recent.map((r) => r.seenOffsetMs)),
        servedDelayMs: spread(served.map((r) => r.servedDelayMs as number)),
        servedOffsetMs: spread(served.map((r) => r.servedOffsetMs as number)),
      },
    };
  }
}

export type EngineView = {
  head: BlockRef | null;
  servedAt: number | null;
  previous: BlockRef | null;
  catchingUp: boolean;
};

export class SyncEngine {
  readonly generation: number;
  readonly #options: SyncEngineOptions;
  readonly #now: () => number;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #running = false;
  #stopped = false;
  #offReason: string | null;
  // Slot length in ms, null for no slot schedule; undefined until the network is known.
  #slotMs: number | null | undefined;
  #polling: Promise<void> | null = null;
  #lastPollOk = false;
  #lastAnsweredAt: number | null = null;
  #lastPoll: PollRecord | null = null;
  #distrustClockUntil = Number.NEGATIVE_INFINITY;
  #observed: Observation | null = null;
  #seq = 0;
  #finalized: { number: bigint | null; askedAt: bigint } | null = null;
  readonly #lanes: Lane[];
  #lastTick: SyncEngineStatus["lastTick"] = null;
  #lastTickSeq = 0;
  #lastFailed = "";
  #polls = 0;
  #ticks = 0;
  #lastServed: BlockRef | null = null;
  #lastServedAt: number | null = null;
  #previousServed: BlockRef | null = null;
  #servedSinceStart = false;
  readonly #clock: HeadClock;

  constructor(options: SyncEngineOptions) {
    this.#options = options;
    this.generation = options.generation;
    this.#now = options.now ?? Date.now;
    this.#offReason = options.mode === "off" ? "SYNC_MODE=off" : null;
    this.#lanes = options.steps.map(() => ({ running: null, queued: null }));
    this.#clock = new HeadClock();
  }

  get active(): boolean {
    return this.#running;
  }

  get mode(): SyncMode {
    return this.#offReason === null ? this.#options.mode : "off";
  }

  resume() {
    if (this.#running || this.#stopped || this.#offReason !== null) return;
    if (!this.#active()) return;
    this.#running = true;
    this.#servedSinceStart = false;
    this.#schedule(0);
  }

  view(): EngineView {
    return {
      head: this.#lastServed,
      servedAt: this.#lastServedAt,
      previous: this.#previousServed,
      catchingUp: this.#running && !this.#servedSinceStart,
    };
  }

  /** Stops for good: no more polls or ticks, and results still in flight are dropped. */
  stop() {
    this.#stopped = true;
    this.#running = false;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
    // Engine work still waiting in the credit pacer is never sent.
    pacer().drop();
    for (const lane of this.#lanes) lane.queued = null;
    const seen = this.#observed;
    if (seen?.deadline) clearTimeout(seen.deadline);
    seen?.resolveServed(false);
  }

  status(): SyncEngineStatus {
    const now = this.#now();
    const seen = this.#observed;
    return {
      mode: this.#offReason === null ? this.#options.mode : "off",
      reason: this.#offReason,
      active: this.#running,
      head: seen && {
        number: seen.polled.head.number.toString(),
        hash: seen.polled.head.hash,
        observedAt: new Date(seen.observedAt).toISOString(),
        confirmedAt: new Date(seen.confirmedAt).toISOString(),
        servedAt: seen.servedAt === null ? null : new Date(seen.servedAt).toISOString(),
        ageMs: Math.max(0, now - seen.confirmedAt),
      },
      lastTick: this.#lastTick && {
        ...this.#lastTick,
        failedSteps: [...this.#lastTick.failedSteps],
      },
      polls: this.#polls,
      ticks: this.#ticks,
      cost: {
        ...upstreamCost(now),
        mode: this.#options.inUse() ? "viewing" : "idle",
        pacer: pacer().status(),
      },
      clock: this.#clock.status(),
    };
  }

  async settled(): Promise<void> {
    for (;;) {
      const running = this.#lanes.flatMap((lane) => (lane.running ? [lane.running] : []));
      if (running.length === 0) return;
      await Promise.all(running);
    }
  }

  #current() {
    return !this.#stopped && this.#options.currentGeneration() === this.generation;
  }

  #active() {
    return this.#options.inUse();
  }

  #schedule(ms: number) {
    if (this.#timer) clearTimeout(this.#timer);
    const timer = setTimeout(() => void this.#wake(), Math.max(0, ms));
    (timer as { unref?: () => void }).unref?.();
    this.#timer = timer;
  }

  async #wake(): Promise<void> {
    this.#timer = null;
    if (!this.#running) return;
    if (!this.#current()) {
      this.stop();
      this.#options.onSuperseded?.();
      return;
    }
    // Nobody uses the app: no timer is left; the next use starts the engine again.
    if (!this.#active()) {
      this.#pause();
      return;
    }
    if (this.#slotMs === undefined) {
      try {
        const net = await this.#options.network();
        if (net.isDevNode) {
          // Anvil and Hardhat can be rewound or changed in place: requests read on demand.
          this.#offReason = "dev node";
          this.#running = false;
          return;
        }
        this.#slotMs = net.name === "local" ? null : net.blockTimeSeconds * 1000;
      } catch {
        if (this.#running) this.#schedule(POLL_MS);
        return;
      }
      if (!this.#running) return;
    }

    const seen = this.#observed;
    const now = this.#now();
    if (
      seen?.slotConfirm &&
      seen.nextSlotAt !== null &&
      now < seen.nextSlotAt &&
      this.#lastPollOk
    ) {
      const next = Math.min(CONFIRM_EVERY_MS, seen.nextSlotAt - now);
      if (!seen.published) {
        this.#schedule(next);
        return;
      }
      // No newer block can exist yet: N stays the head for another 4 s without asking the node.
      if (seen.polled.confirm()) {
        seen.confirmedAt = now;
        this.#schedule(next);
        return;
      }
    }
    await this.#poll();
    if (!this.#running) return;
    if (!this.#active()) {
      this.#pause();
      return;
    }
    this.#schedule(this.#nextDelay());
  }

  #pause() {
    this.#running = false;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
    pacer().drop();
    // The first poll after a pause is sent at no particular moment: it proves nothing about the
    // clock.
    if (this.#observed) this.#observed.slotConfirm = false;
  }

  #nextDelay(): number {
    const seen = this.#observed;
    if (!this.#lastPollOk || !seen || seen.nextSlotAt === null || !this.#slotMs) return POLL_MS;
    const now = this.#now();
    // Before the next slot: every 2 s, the last exactly when it begins. A poll then that still
    // finds this head is the proof that lets the next head be confirmed by the clock.
    if (now < seen.nextSlotAt) return Math.min(CONFIRM_EVERY_MS, seen.nextSlotAt - now);
    if (now < seen.nextSlotAt + this.#slotMs) return SLOT_POLL_MS;
    return POLL_MS;
  }

  #poll(): Promise<void> {
    if (this.#polling) return this.#polling;
    const run = this.#readHead().finally(() => {
      this.#polling = null;
    });
    this.#polling = run;
    return run;
  }

  async #readHead(): Promise<void> {
    const withFinalized = this.#finalizedDue();
    // Paced, waited for before the read: a request reading the head meanwhile never waits on it.
    const wait = this.#options.pacePoll?.(withFinalized) ?? null;
    if (wait) {
      try {
        await wait;
      } catch {
        // Dropped unsent (sync/pacer.ts).
        return;
      }
      if (!this.#running || !this.#current() || !this.#active()) return;
    }
    const askedAt = this.#now();
    this.#polls++;
    let polled: PolledHead;
    try {
      polled = await this.#options.pollHead({ withFinalized });
    } catch {
      this.#lastPollOk = false;
      return;
    }
    if (!this.#current() || polled.generation !== this.generation) return;
    if (!this.#active()) return;
    // A poll that joined a request's head read in flight was sent when that read was.
    const sentAt = polled.sentAt ?? askedAt;
    this.#lastPollOk = true;
    this.#lastAnsweredAt = this.#now();
    this.#clock.noteRtt(polled.answeredAt - sentAt);
    if (polled.finalized !== undefined)
      this.#finalized = { number: polled.finalized?.number ?? null, askedAt: polled.head.number };
    const previous = this.#lastPoll;
    this.#lastPoll = {
      sentAt,
      hash: polled.head.hash,
      timestampMs: Number(polled.head.timestamp) * 1000,
    };
    this.#observe(polled, previous, sentAt);
  }

  #finalizedDue(): boolean {
    const known = this.#finalized;
    const head = this.#observed?.polled.head.number;
    if (!known || head === undefined || this.#lastAnsweredAt === null) return true;
    if (this.#now() - this.#lastAnsweredAt >= FINALIZED_AFTER_GAP_MS) return true;
    const next = head + 1n;
    if (next - known.askedAt >= FINALIZED_EVERY) return true;
    return known.number !== null && next - known.number > MAX_TAIL;
  }

  #distrustClock(now: number) {
    this.#distrustClockUntil = now + CLOCK_DISTRUST_MS;
  }

  #observe(polled: PolledHead, previous: PollRecord | null, sentAt: number) {
    const now = this.#now();
    const seen = this.#observed;
    if (seen && seen.polled.head.hash === polled.head.hash) {
      // The same head again: a real confirmation, once it is served.
      seen.polled = polled;
      if (seen.published && polled.publish()) {
        seen.confirmedAt = polled.answeredAt;
        this.#servedSinceStart = true;
      }
      return;
    }
    // Below the followed head (a lagging backend): not adopted.
    if (seen && polled.head.number < seen.polled.head.number) return;
    if (!polled.isNewest()) return;

    // Confirming a head by the clock is safe only while the local clock is not behind the chain's.
    // The only bound on that: a poll sent when this head's slot had begun by the local clock that
    // still found the head before it. The block was not at the node yet, so the next slot's
    // confirmations end before the next block can arrive.
    const timestampMs = Number(polled.head.timestamp) * 1000;
    const skew = now - timestampMs;
    const proven =
      previous !== null &&
      seen !== null &&
      previous.hash === seen.polled.head.hash &&
      previous.sentAt >= timestampMs &&
      previous.timestampMs < timestampMs;
    // The previous head was confirmed by the clock without that proof for this one.
    const suspect = !!seen?.slotConfirm && !proven;
    // Signs that the clock is behind: a head from the local clock's future, or one already at the
    // node when its slot began by the local clock while the previous head was confirmed by it.
    if (skew < 0 || (suspect && sentAt <= timestampMs + SLOT_POLL_MS)) this.#distrustClock(now);
    const slotMs = this.#slotMs;
    const onSchedule = !!slotMs && skew >= 0 && skew <= MAX_SKEW_MS;

    if (seen) {
      if (seen.deadline) clearTimeout(seen.deadline);
      seen.deadline = null;
      seen.resolveServed(false);
    }
    let resolveServed: (served: boolean) => void = () => {};
    const served = new Promise<boolean>((resolve) => {
      resolveServed = resolve;
    });
    this.#clock.noteSeen(
      polled.head,
      seen && { head: seen.polled.head, pollsAtSeen: seen.pollsAtSeen },
      now,
      this.#polls
    );
    const observation: Observation = {
      seq: ++this.#seq,
      polled,
      observedAt: now,
      confirmedAt: polled.answeredAt,
      nextSlotAt: onSchedule && slotMs ? timestampMs + slotMs : null,
      slotConfirm: onSchedule && proven && now >= this.#distrustClockUntil,
      pollsAtSeen: this.#polls,
      published: false,
      servedAt: null,
      deadline: null,
      served,
      resolveServed,
    };
    const deadline = setTimeout(() => this.#publish(observation), PUBLISH_WITHIN_MS);
    (deadline as { unref?: () => void }).unref?.();
    observation.deadline = deadline;
    this.#observed = observation;
    // The previous head may have been confirmed wrongly: this one is served at once.
    if (suspect) this.#publish(observation);
    this.#requestTick(observation);
  }

  #publish(observation: Observation) {
    if (observation.published) return;
    observation.published = true;
    if (observation.deadline) clearTimeout(observation.deadline);
    observation.deadline = null;
    // Only the head followed now: an orphaned block must never come back after its replacement was
    // served. publish() also says no when a newer head is known elsewhere.
    const served =
      this.#current() && observation === this.#observed && observation.polled.publish();
    if (served) {
      observation.confirmedAt = observation.polled.answeredAt;
      observation.servedAt = this.#now();
      if (this.#lastServed && this.#lastServed.hash !== observation.polled.head.hash)
        this.#previousServed = this.#lastServed;
      this.#lastServed = observation.polled.head;
      this.#lastServedAt = observation.servedAt;
      this.#servedSinceStart = true;
      this.#clock.noteServed(observation.polled.head, observation.observedAt, observation.servedAt);
    }
    observation.resolveServed(served);
  }

  /** Runs every step for a new head, each on its own lane: a slow step delays only its next run. */
  #requestTick(observation: Observation) {
    const { steps } = this.#options;
    const { polled } = observation;
    const tick: Tick = {
      head: polled.head,
      generation: this.generation,
      inUse: () => this.#current() && this.#running && this.#options.inUse(),
      boundary: () => polled.boundary(),
      current: () => this.#current(),
      served: () => observation.served,
    };
    const run: Run = {
      observation,
      tick,
      started: this.#now(),
      open: steps.length,
      waiting: steps.filter((step) => step.beforePublish).length,
      ran: 0,
      failed: new Map(),
    };
    if (run.waiting === 0) this.#publish(observation);
    if (run.open === 0) {
      this.#finish(run);
      return;
    }
    for (let i = 0; i < steps.length; i++) {
      const lane = this.#lanes[i] as Lane;
      if (!lane.running) {
        this.#start(i, run);
        continue;
      }
      const replaced = lane.queued;
      lane.queued = run;
      if (replaced) this.#close(replaced, i);
    }
  }

  #start(i: number, run: Run) {
    const lane = this.#lanes[i] as Lane;
    const step = this.#options.steps[i] as TickStep;
    run.ran++;
    lane.running = Promise.resolve()
      .then(() => {
        if (!this.#active()) throw new StepSkipped("not in use");
        return asEngineWork(() => step.run(run.tick));
      })
      .then(
        () => {},
        (error: unknown) => {
          // Use ended while it ran: not a failure of the data source.
          if (error instanceof StepSkipped || !this.#active()) return;
          run.failed.set(i, errorKind(error));
        }
      )
      .then(() => {
        lane.running = null;
        this.#close(run, i);
        const next = lane.queued;
        lane.queued = null;
        if (!next) return;
        if (this.#running && this.#current()) this.#start(i, next);
        else this.#close(next, i);
      });
  }

  #close(run: Run, i: number) {
    run.open--;
    if (this.#options.steps[i]?.beforePublish && --run.waiting === 0)
      this.#publish(run.observation);
    if (run.open === 0) this.#finish(run);
  }

  #finish(run: Run) {
    if (!this.#current()) return;
    if (run.ran === 0 && this.#options.steps.length > 0) return;
    this.#ticks++;
    // An older head's steps can finish after a newer head's: the newest head's tick is reported.
    if (run.observation.seq < this.#lastTickSeq) return;
    this.#lastTickSeq = run.observation.seq;
    const block = run.tick.head.number.toString();
    const failed: string[] = [];
    const kinds: Record<string, string> = {};
    this.#options.steps.forEach((step, i) => {
      const kind = run.failed.get(i);
      if (kind === undefined) return;
      failed.push(step.name);
      kinds[step.name] = kind;
    });
    this.#lastTick = { block, ms: Math.max(0, this.#now() - run.started), failedSteps: failed };
    // Logged when the set of failing steps changes, not on every block.
    const signature = failed.join(",");
    if (signature !== this.#lastFailed) {
      this.#lastFailed = signature;
      if (failed.length > 0) log.warn({ block, failed, errors: kinds }, "sync tick");
      else log.info({ block }, "sync tick recovered");
    }
  }
}

// ---- the live engine ----

// Safe info is read again this long before it would expire, so requests keep hitting.
const SAFE_INFO_REFRESH_BEFORE_MS = 60_000;

export function liveSteps(): TickStep[] {
  const snapshot = snapshotState();
  // One governance read per tick, its 30 s counted from its answer. `shared`: the read requests
  // share (none was served when the tick started, or one was in flight): never a second read
  // beside it. Otherwise it is read at the tick's head and stored once the head is served.
  type TickGovernance = { value: Governance; at: number; shared: boolean };
  const governanceOf = new WeakMap<Tick, Promise<TickGovernance>>();
  const sharedGovernance = (tick: Tick) =>
    remainingMs(GOVERNANCE_KEY) === null && servedHead() === null
      ? cached(GOVERNANCE_KEY, GOVERNANCE_TTL_MS, () => readGovernance(tick.head))
      : governance();
  const governanceFor = (tick: Tick) => {
    let read = governanceOf.get(tick);
    if (!read) {
      const left = remainingMs(GOVERNANCE_KEY);
      const shared = left === null || left === Number.POSITIVE_INFINITY;
      read = (shared ? sharedGovernance(tick) : readGovernance(tick.head)).then((value) => ({
        value,
        at: Date.now(),
        shared,
      }));
      governanceOf.set(tick, read);
    }
    return read;
  };

  return [
    {
      name: "index",
      beforePublish: true,
      run: async (tick) => puhIndex().syncHead({ head: tick.head, safe: await tick.boundary() }),
    },
    // Stored once its head is served (never ahead of the head requests read), for 30 s from the
    // read's answer; on failure the last good value stays for its 30 s.
    {
      name: "governance",
      run: async (tick) => {
        // With pinned code, pages read governance in the snapshot and JSON reads it on demand.
        if (await governanceSplitApplies())
          throw new StepSkipped("pages read governance at each head (snapshot)");
        const { value, at, shared } = await governanceFor(tick);
        if (shared) return;
        if (!(await tick.served())) throw new StepSkipped("head replaced before it was served");
        if (!tick.current()) return;
        replace(GOVERNANCE_KEY, value, GOVERNANCE_TTL_MS - (Date.now() - at));
      },
    },
    { name: "snapshot", beforePublish: true, run: (tick) => snapshotStep(tick, snapshot) },
    {
      name: "safes",
      run: async (tick) => {
        const due = onScreenSafes().filter((safe) => {
          const left = remainingMs(safeInfoKey(safe));
          return left === null || left < SAFE_INFO_REFRESH_BEFORE_MS;
        });
        await Promise.all(
          due.map(async (safe) => {
            if (remainingMs(safeInfoKey(safe)) === null) {
              await safeInfo(safe, tick.head);
              return;
            }
            const info = await readSafeInfo(safe, tick.head);
            if (tick.current()) replace(safeInfoKey(safe), info, SAFE_INFO_TTL_MS);
          })
        );
      },
    },
    signaturesStep(),
    // Simulations on screen, at this head before it is served: none from an older block as current.
    {
      name: "simulations",
      beforePublish: true,
      run: async (tick) => {
        const keys = [...presence().onScreen()].filter((key) => key.startsWith("sim:"));
        if (keys.length === 0) return;
        await resimulateOnScreen(tick.head, keys, () => tick.current() && tick.inUse());
      },
    },
    // Once the head is served: what is on screen, digested from memory, and the lists' Safes.
    {
      name: "content",
      run: async (tick) => {
        try {
          startEraWatch(eraWatch);
          if (!(await tick.served())) throw new StepSkipped("head replaced before it was served");
          await refreshListSafes();
          const keys = [...presence().onScreen()].filter(
            (key) => !key.startsWith("set:") && !key.startsWith("sim:") && !isL2Key(key)
          );
          if (presence().onScreen().has("list:vetoes")) keys.push("list:vetoes");
          await noteOnScreenContent(tick.head, keys, () => tick.current() && tick.inUse());
        } finally {
          contentPassedAt = tick.head.hash;
        }
      },
    },
  ];
}

// The signer groups' Safes the lists on screen collect from, from the last governance pages read.
let groupSafes: { council: Address[]; guardians: Address[]; foundation: Address } | null = null;

async function refreshListSafes(): Promise<void> {
  try {
    const gov = await pageGovernance();
    groupSafes = {
      council: gov.securityCouncil.members,
      guardians: gov.guardians.members,
      foundation: gov.emergencyUpgradeBoard.zkFoundation,
    };
  } catch {
    // Kept as it was: the next tick reads it again.
  }
}

function listSafes(keys: ReadonlySet<string>): Address[] {
  const groups = groupSafes;
  if (!groups) return [];
  const safes: Address[] = [];
  if ([...keys].some((key) => key.startsWith("list:emergency")))
    safes.push(...groups.council, ...groups.guardians, groups.foundation);
  if (keys.has("list:freeze")) safes.push(...groups.council);
  if (keys.has("list:vetoes")) safes.push(...groups.guardians);
  return safes;
}

/** How the Safes behind each list key a tab shows are kept ("Safe checked 2m ago"). */
export function listSafeChecks(keys: readonly string[]): Record<string, SafeCheck> {
  const checks: Record<string, SafeCheck> = {};
  for (const key of keys) {
    if (!key.startsWith("list:emergency") && key !== "list:freeze" && key !== "list:vetoes")
      continue;
    const safes = listSafes(new Set([key]));
    if (safes.length > 0) checks[key] = safeCheckOf(safes, "list");
  }
  return checks;
}

function onScreenSafes(): Address[] {
  const safes = new Map<string, Address>();
  for (const { members } of onScreenSigners())
    for (const safe of members) safes.set(safe.toLowerCase(), safe);
  return [...safes.values()];
}

class PrecomputeFailed extends Error {
  override name = "PrecomputeFailed";
}

/**
 * Verifies the signature sets on screen at the new head before it is served, so the first request
 * at it finds them; sets that would need Safe are left to requests. Verdicts are kept under the
 * head's hash: another head never uses them.
 */
export function signaturesStep(): TickStep {
  return {
    name: "signatures",
    beforePublish: true,
    run: async (tick) => {
      if (!tick.current()) return;
      // No more sets start once use ended (nothing is on screen then).
      const run = await precomputeSignatureSets(tick.head, {
        current: () => tick.current() && tick.inUse(),
      });
      if (run.failed > 0) throw new PrecomputeFailed(`${run.failed} of ${run.sets} sets failed`);
    },
  };
}

// presence.ts and pacer.ts read no environment themselves.
readKeepWarmFrom(() => env.SYNC_KEEPWARM_MS);
readRateFrom(() => env.SYNC_CREDITS_PER_SECOND);

let instance: SyncEngine | null = null;

function engineMaySend(): boolean {
  return (
    presence().inUse() ||
    (instance !== null && instance.generation === rpcGeneration() && instance.active)
  );
}

// The pin check and the engine's paced work read only while someone uses the app or the engine
// follows the chain; what waits past that, or past a settings change, is dropped unsent.
allowPinChecksWhen(engineMaySend);

allowEngineWorkWhen({ allowed: engineMaySend, generation: rpcGeneration });

function engine(): SyncEngine {
  const generation = rpcGeneration();
  if (instance?.generation === generation) return instance;
  instance?.stop();
  const next = new SyncEngine({
    mode: env.SYNC_MODE,
    inUse: () => presence().inUse(),
    generation,
    currentGeneration: rpcGeneration,
    network,
    pollHead,
    steps: liveSteps(),
    pacePoll: (withFinalized) =>
      pacer().take(creditsOf("eth_getBlockByNumber") * (withFinalized ? 2 : 1)),
    onSuperseded: () => {
      engine().resume();
    },
  });
  instance = next;
  return next;
}

const engineActive = () =>
  instance !== null && instance.generation === rpcGeneration() && instance.active;

// A dev node is not followed, but the Safe watcher still runs while the app is in use (never with
// SYNC_MODE=off), so a signature filed in Safe still reaches an open page.
const devNodeInUse = () =>
  env.SYNC_MODE !== "off" && resolvedNetwork()?.isDevNode === true && presence().inUse();

// The Safe watcher: the members of open sets on screen whose signature is not valid yet, and the
// Safes behind the lists on screen, while the engine runs and someone uses the app.
const safeWatch: SafeWatchDriver = {
  active: () => (engineActive() && presence().inUse()) || devNodeInUse(),
  watched: () => {
    const watched: WatchedSafe[] = watchedSetMembers().map((safe) => ({ safe, kind: "set" }));
    for (const safe of listSafes(presence().onScreen())) watched.push({ safe, kind: "list" });
    return watched;
  },
};

const signatureWatch: SignatureWatchDriver = {
  active: engineActive,
  viewing: () => presence().inUse(),
  head: servedHead,
  readsAtLatest: devNodeInUse,
};

const eraWatch = {
  active: () => engineActive() && presence().inUse(),
  keys: () => presence().onScreen(),
};

function startDrivers() {
  startSafeWatch(safeWatch);
  startSignatureWatch(signatureWatch);
  startEraWatch(eraWatch);
  if (groupSafes === null && engineActive()) void refreshListSafes().then(nudgeSafeWatch);
}

/** The viewer just signed for a member Safe of a set on screen: its listing is read a few times. */
export function noteSigned(safe: Address) {
  try {
    const lower = safe.toLowerCase();
    const onScreen = [...presence().onScreen()].some((key) =>
      pageSetOf(key)?.members.some((member) => member.toLowerCase() === lower)
    );
    if (!onScreen) return;
    safeBurst(safe, () => presence().inUse());
  } catch (error) {
    log.warn({ error: errorKind(error) }, "sync signed note failed");
  }
}

export function wakeSync() {
  try {
    engine().resume();
    startDrivers();
  } catch (error) {
    log.warn({ error: errorKind(error) }, "sync wake failed");
  }
}

/** A page load (see isPageLoad) counts as use and wakes the engine. Never throws or waits. */
export function noteRequest(info: RequestInfo) {
  try {
    if (!isPageLoad(info)) return;
    presence().load();
    wakeSync();
  } catch (error) {
    log.warn({ error: errorKind(error) }, "sync request note failed");
  }
}

/** At start and after a settings change: follows only if someone uses the app already. */
export function startSync() {
  wakeSync();
}

export function syncEngineStatus(): SyncEngineStatus {
  if (instance && instance.generation === rpcGeneration()) return instance.status();
  const mode = env.SYNC_MODE;
  return {
    mode,
    reason: mode === "off" ? "SYNC_MODE=off" : null,
    active: false,
    head: null,
    lastTick: null,
    polls: 0,
    ticks: 0,
    cost: {
      ...upstreamCost(),
      mode: presence().inUse() ? "viewing" : "idle",
      pacer: pacer().status(),
    },
    clock: new HeadClock().status(),
  };
}

let contentPassedAt: string | null = null;
// A beat may name the head before a new one for this long, while the content pass at it runs.
const CONTENT_PASS_GRACE_MS = 2_000;

/**
 * For a tab's beat, from memory: a head is named once the content pass at it is done, or 2 s after
 * it was served, so no item reads as not re-read at it only because its pass had not finished.
 */
export function syncView(): { head: BlockRef | null; catchingUp: boolean } {
  if (!instance || instance.generation !== rpcGeneration())
    return { head: null, catchingUp: false };
  const { head, servedAt, previous, catchingUp } = instance.view();
  const passing =
    head !== null &&
    previous !== null &&
    contentPassedAt !== head.hash &&
    servedAt !== null &&
    Date.now() - servedAt < CONTENT_PASS_GRACE_MS;
  return { head: passing ? previous : head, catchingUp };
}

/** Stops the engine (tests, shutdown). The next use starts a new one. */
export function stopSync() {
  instance?.stop();
  instance = null;
  contentPassedAt = null;
  groupSafes = null;
  stopSafeWatch();
  stopSignatureWatch();
  stopEraWatch();
}
