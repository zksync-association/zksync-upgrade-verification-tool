import { defaultLogger } from "@config/log.server";
import { env } from "@config/env.server";
import type { Hex } from "viem";
import { remainingMs, replace } from "../cache";
import { puhIndex } from "../chain/puh-index";
import { refreshVetoableL2 } from "../flows/l2";
import {
  GOVERNANCE_KEY,
  GOVERNANCE_TTL_MS,
  type Governance,
  SAFE_INFO_TTL_MS,
  governance,
  readGovernance,
  readSafeInfo,
  safeInfoKey,
} from "../governance";
import { governanceSafes } from "../prewarm";
import {
  type BlockRef,
  type Network,
  type PolledHead,
  network,
  pollHead,
  rpcGeneration,
  servedHead,
} from "../rpc";
import { type SafeSweepDriver, startSafeSweep, stopSafeSweep } from "../safe/store";
import {
  type SignatureWatchDriver,
  precomputeSignatureSets,
  startSignatureWatch,
  stopSignatureWatch,
} from "../signatures";
import {
  type UpgradeStatusRead,
  isTerminalState,
  readUpgradeStatus,
  seedUpgradeStatus,
  upgradeStatusAt,
} from "../upgrade-status";
import { type UpstreamCost, upstreamCost } from "./cost";

// The sync engine follows the chain head and, on every new block, refills the same cache entries
// requests read (the head, governance, upgrade states, Safe info, the signature sets pages viewed),
// so a request finds them fresh and asks nothing upstream. It never serves anything itself: when
// it is stopped, failing or off, requests read on demand exactly as without it, with the same
// lifetimes (head 4 s, governance 30 s). State read at the head is keyed by the head's hash.
//
// SYNC_MODE=always (the default) follows the head for as long as the process runs; "window" only
// while the app is in use (a request within SYNC_KEEPWARM_MS), as before. Either way a tick knows
// whether someone is viewing (a request within SYNC_KEEPWARM_MS). While idle it does less, within
// the same bounds: governance is read at most every second block (never past its 30 s), only the
// signature sets that were open when last viewed are verified again, and Era is not read. Reads
// of /api/status are not a visit (see countsAsVisit): polling the status never changes the
// profile, nor the cost and mode the status reports.
//
// A new head is served (published as the cached head) once what requests at it need has been
// read (the index tail, upgrade states), at most 2 s after it was seen, and only while it is still
// the head the engine follows. Until then requests keep the previous head, within its own 4 s
// since it was last confirmed (at once instead when the previous head was confirmed by the clock
// and those confirmations may have been wrong). Each step runs on its own: a slow step for one
// head delays only that step's next run, never the other steps of newer heads.
//
// Timers are unref'd; in "window" mode they stop when nobody has made a request for
// SYNC_KEEPWARM_MS. Nothing here logs an error's text: it can carry the RPC URL and its key.

export type SyncMode = "window" | "always" | "off";

export type SyncEngineStatus = {
  /** "off" also for dev nodes, which always read on demand (see `reason`). */
  mode: SyncMode;
  /** Why the engine is off, or null. */
  reason: string | null;
  /**
   * Following the head right now. With SYNC_MODE=always: for as long as the process runs, in use
   * or idle (`cost.mode` tells which); with "window": only while the app is in use.
   */
  active: boolean;
  /** The newest head the engine has seen; ageMs is the time since it was last confirmed. */
  head: {
    number: string;
    hash: Hex;
    observedAt: string;
    confirmedAt: string;
    ageMs: number;
  } | null;
  /** The last finished tick: the block, how long its steps took, and the steps that failed. */
  lastTick: { block: string; ms: number; failedSteps: string[] } | null;
  polls: number;
  ticks: number;
  /**
   * What the app asked upstream in the last hour (requests and background work alike), and
   * whether someone is using the app now ("viewing": a request within SYNC_KEEPWARM_MS, reads of
   * /api/status not counted) or not.
   */
  cost: UpstreamCost & { mode: "viewing" | "idle" };
};

/** What a tick's steps get: the new head, and whether the settings are still the ones it ran for. */
export type Tick = {
  head: BlockRef;
  generation: number;
  /**
   * The full profile applies: someone was using the app when the head was seen (a request within
   * SYNC_KEEPWARM_MS). Always true in "window" mode, which runs only then.
   */
  viewing: boolean;
  /** The engine still runs for these settings, and someone is using the app now. */
  inUse(): boolean;
  /** The chain's slot length (12 s on mainnet), or null without a slot schedule. */
  slotMs: number | null;
  /** The finality boundary F at this head. */
  boundary(): Promise<bigint>;
  current(): boolean;
  /**
   * Settles once the head was served (true), or will never be (false: a newer head replaced it,
   * or the engine stopped).
   */
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
  keepWarmMs: number;
  generation: number;
  /** When the last request was made (carried over to the engine for new settings). */
  lastTouch?: number | null;
  now?: () => number;
  /** The current settings generation (rpc.ts). */
  currentGeneration: () => number;
  network: () => Promise<Pick<Network, "isDevNode" | "name" | "blockTimeSeconds">>;
  pollHead: (options: { withFinalized: boolean }) => Promise<PolledHead>;
  steps: readonly TickStep[];
  /** Called when this engine finds that the settings changed (it has stopped itself). */
  onSuperseded?: () => void;
};

// Head follower cadence. On a chain with fixed slots, block N+1 cannot exist before N's timestamp
// plus one slot, so until then N is re-confirmed without asking the node (once the local clock is
// shown not to run behind, see #observe); from then on the node is asked every second, and every
// 2 s once a slot was missed. Without that proof, or elsewhere: every 2 s.
const CONFIRM_EVERY_MS = 2_000;
const SLOT_POLL_MS = 1_000;
const POLL_MS = 2_000;
// The slot schedule applies to a head seen between 0 and two slots after its own timestamp.
const MAX_SKEW_MS = 24_000;
// After a sign that the local clock runs behind the chain, heads are confirmed only by the node
// for this long.
const CLOCK_DISTRUST_MS = 10 * 60_000;
// 'finalized' is asked again every 32 blocks, or before the tail above it would pass 128 blocks,
// and on the first poll after a gap (idle, failing): the head may have moved any distance.
const FINALIZED_EVERY = 32n;
const MAX_TAIL = 128n;
const FINALIZED_AFTER_GAP_MS = 60_000;
// A new head is served at the latest this long after it was seen, its tick finished or not.
const PUBLISH_WITHIN_MS = 2_000;

type Observation = {
  /** Observations are numbered in order: the newest has the highest. */
  seq: number;
  polled: PolledHead;
  observedAt: number;
  confirmedAt: number;
  /** Local time at which the next slot starts; null when the head is off the slot schedule. */
  nextSlotAt: number | null;
  /** Until nextSlotAt the head is re-confirmed without asking the node (see #observe). */
  slotConfirm: boolean;
  /** Its publication point passed (its tick read what requests need, or the deadline). */
  published: boolean;
  deadline: ReturnType<typeof setTimeout> | null;
  /** Settles once the head was served (true), or will never be: replaced, or retired (false). */
  served: Promise<boolean>;
  resolveServed: (served: boolean) => void;
};

/** The last head poll the node answered: when it was sent, and the head it named. */
type PollRecord = { sentAt: number; hash: Hex; timestampMs: number };

/** One head's tick: its steps, each run on that step's own lane. */
type Run = {
  observation: Observation;
  tick: Tick;
  started: number;
  /** Steps not yet settled for this head, or handed to a newer head. */
  open: number;
  /** The beforePublish steps among them. */
  waiting: number;
  /** Steps that ran (or are running) for this head. */
  ran: number;
  /** Indexes of the steps that failed, with the kind of error. */
  failed: Map<number, string>;
};

/**
 * One step's runs, one head at a time. A head that arrives while the step is busy waits; a newer
 * head that arrives meanwhile takes its place (only the newest head waiting is run).
 */
type Lane = { running: Promise<void> | null; queued: Run | null };

const log = defaultLogger.child({ module: "sync" });

/** A class name such as "HttpRequestError", never the error's text. */
function errorKind(error: unknown): string {
  const name = error instanceof Error ? error.name : typeof error;
  return /^[A-Za-z]\w{0,63}$/.test(name) ? name : "Error";
}

export class SyncEngine {
  readonly generation: number;
  readonly #options: SyncEngineOptions;
  readonly #now: () => number;
  #lastTouch: number | null;
  #timer: ReturnType<typeof setTimeout> | null = null;
  // The follower loop is scheduled (or mid-wake).
  #running = false;
  // Retired: the settings changed, or stop() was called.
  #stopped = false;
  #offReason: string | null;
  // Slot length in ms, null for no slot schedule; undefined until the network is known.
  #slotMs: number | null | undefined;
  #polling: Promise<void> | null = null;
  #lastPollOk = false;
  // When the node last answered a poll, and the poll it answered.
  #lastAnsweredAt: number | null = null;
  #lastPoll: PollRecord | null = null;
  // Until then no head is confirmed by the clock alone.
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

  constructor(options: SyncEngineOptions) {
    this.#options = options;
    this.generation = options.generation;
    this.#now = options.now ?? Date.now;
    this.#lastTouch = options.lastTouch ?? null;
    this.#offReason = options.mode === "off" ? "SYNC_MODE=off" : null;
    this.#lanes = options.steps.map(() => ({ running: null, queued: null }));
  }

  get lastTouch(): number | null {
    return this.#lastTouch;
  }

  /** Following the head right now (false while stopped for inactivity, off, or retired). */
  get active(): boolean {
    return this.#running;
  }

  /** Someone is using the app: a request within SYNC_KEEPWARM_MS. */
  get viewing(): boolean {
    return this.#lastTouch !== null && this.#now() - this.#lastTouch <= this.#options.keepWarmMs;
  }

  get mode(): SyncMode {
    return this.#offReason === null ? this.#options.mode : "off";
  }

  /** A request was made: keeps the engine running, or starts it (that request reads on demand). */
  touch() {
    this.#lastTouch = this.#now();
    this.resume();
  }

  /** Starts following the head when the engine should be running and is not. */
  resume() {
    if (this.#running || this.#stopped || this.#offReason !== null) return;
    if (!this.#active()) return;
    this.#running = true;
    this.#schedule(0);
  }

  /** Stops for good: no more polls or ticks, and results still in flight are dropped. */
  stop() {
    this.#stopped = true;
    this.#running = false;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
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
        ageMs: Math.max(0, now - seen.confirmedAt),
      },
      lastTick: this.#lastTick && {
        ...this.#lastTick,
        failedSteps: [...this.#lastTick.failedSteps],
      },
      polls: this.#polls,
      ticks: this.#ticks,
      cost: { ...upstreamCost(now), mode: this.viewing ? "viewing" : "idle" },
    };
  }

  /** Resolves once no step is running or waiting for any head. For tests. */
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
    return this.#options.mode === "always" || this.viewing;
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
    // Idle: every timer stops; the next request starts the engine again.
    if (!this.#active()) {
      this.#running = false;
      // The head after the pause is found by a poll sent at no particular moment: no sign either
      // way about the clock (see #observe), and no clock confirmations until a poll proves it.
      if (this.#observed) this.#observed.slotConfirm = false;
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
      // Not served yet: its tick (or the deadline) publishes it.
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
      // Another head has been seen since (a request read it): ask the node.
    }
    await this.#poll();
    if (this.#running) this.#schedule(this.#nextDelay());
  }

  #nextDelay(): number {
    const seen = this.#observed;
    if (!this.#lastPollOk || !seen || seen.nextSlotAt === null || !this.#slotMs) return POLL_MS;
    const now = this.#now();
    // Before the next slot: confirmations (or polls, without the clock's proof) every 2 s, the
    // last one exactly when the slot begins. A poll then that still finds this head is the proof
    // that lets the next head be confirmed by the clock.
    if (now < seen.nextSlotAt) return Math.min(CONFIRM_EVERY_MS, seen.nextSlotAt - now);
    if (now < seen.nextSlotAt + this.#slotMs) return SLOT_POLL_MS;
    return POLL_MS;
  }

  /** One head read at a time: a slow poll is waited for, never stacked. */
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
    const sentAt = this.#now();
    this.#polls++;
    let polled: PolledHead;
    try {
      polled = await this.#options.pollHead({ withFinalized });
    } catch {
      // The cached head is left to expire; requests then read on demand.
      this.#lastPollOk = false;
      return;
    }
    if (!this.#current() || polled.generation !== this.generation) return;
    this.#lastPollOk = true;
    this.#lastAnsweredAt = this.#now();
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

  /** `sentAt`: when the poll that named `polled` was sent; `previous`: the poll answered before. */
  #observe(polled: PolledHead, previous: PollRecord | null, sentAt: number) {
    const now = this.#now();
    const seen = this.#observed;
    if (seen && seen.polled.head.hash === polled.head.hash) {
      // The node named the same head again: a real confirmation, once it is served (for 4 s
      // from this answer).
      seen.polled = polled;
      if (seen.published && polled.publish()) seen.confirmedAt = polled.answeredAt;
      return;
    }
    // Below the head being followed, or below a head a request read (a lagging backend): not
    // adopted. The followed head stays, with its tick and its deadline.
    if (seen && polled.head.number < seen.polled.head.number) return;
    if (!polled.isNewest()) return;

    // Confirming a head by the clock alone is safe only while the local clock is not behind the
    // chain's: a clock d seconds behind would keep confirming N for up to d seconds after N+1
    // appeared. Nothing the node says bounds d from above except this: a poll sent when, by the
    // local clock, this head's slot had already begun, and that still found the head before it.
    // The block was not at the node yet, so the clock is behind by less than the block took to
    // get there, and the next slot's confirmations end before the next block can arrive.
    const timestampMs = Number(polled.head.timestamp) * 1000;
    const skew = now - timestampMs;
    const proven =
      previous !== null &&
      seen !== null &&
      previous.hash === seen.polled.head.hash &&
      previous.sentAt >= timestampMs &&
      previous.timestampMs < timestampMs;
    // The previous head was confirmed by the clock, and nothing shows this one reached the node
    // after its slot began by the local clock: those confirmations may have stood in for it.
    const suspect = !!seen?.slotConfirm && !proven;
    // Signs that the clock is behind: this head is from the local clock's future; or, while the
    // previous head was confirmed by the clock, the poll sent when this head's slot began (by the
    // local clock) found it already at the node. A poll sent later (after a failed poll, or a
    // pause) shows nothing either way.
    if (skew < 0 || (suspect && sentAt <= timestampMs + SLOT_POLL_MS)) this.#distrustClock(now);
    const slotMs = this.#slotMs;
    const onSchedule = !!slotMs && skew >= 0 && skew <= MAX_SKEW_MS;

    if (seen) {
      if (seen.deadline) clearTimeout(seen.deadline);
      seen.deadline = null;
      // Replaced before it was served: it never will be.
      seen.resolveServed(false);
    }
    let resolveServed: (served: boolean) => void = () => {};
    const served = new Promise<boolean>((resolve) => {
      resolveServed = resolve;
    });
    const observation: Observation = {
      seq: ++this.#seq,
      polled,
      observedAt: now,
      confirmedAt: polled.answeredAt,
      nextSlotAt: onSchedule && slotMs ? timestampMs + slotMs : null,
      slotConfirm: onSchedule && proven && now >= this.#distrustClockUntil,
      published: false,
      deadline: null,
      served,
      resolveServed,
    };
    const deadline = setTimeout(() => this.#publish(observation), PUBLISH_WITHIN_MS);
    (deadline as { unref?: () => void }).unref?.();
    observation.deadline = deadline;
    this.#observed = observation;
    // The previous head may be served on a wrong clock confirmation now: this one is served at
    // once, without waiting for its tick (requests at it read on demand what is not seeded yet).
    if (suspect) this.#publish(observation);
    this.#requestTick(observation);
  }

  /** Serves an observed head (once): the next requests read it and what its tick seeded. */
  #publish(observation: Observation) {
    if (observation.published) return;
    observation.published = true;
    if (observation.deadline) clearTimeout(observation.deadline);
    observation.deadline = null;
    // Only the head the engine follows now. One replaced since (a newer head, or another block at
    // the same height) is never served: an orphaned block must not come back after its
    // replacement was served. publish() also says no when a newer head is known elsewhere.
    const served =
      this.#current() && observation === this.#observed && observation.polled.publish();
    if (served) observation.confirmedAt = observation.polled.answeredAt;
    observation.resolveServed(served);
  }

  /**
   * Runs every step for a new head. Each step has its own lane: a step still busy with an older
   * head (a slow governance read) holds up only its own next run, never the other steps' runs for
   * newer heads.
   */
  #requestTick(observation: Observation) {
    const { steps } = this.#options;
    const { polled } = observation;
    const tick: Tick = {
      head: polled.head,
      generation: this.generation,
      viewing: this.#options.mode === "window" || this.viewing,
      inUse: () => this.#current() && this.#running && this.viewing,
      slotMs: this.#slotMs ?? null,
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
      // Busy with an older head: this head runs next, in place of any head waiting before it.
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
      .then(() => step.run(run.tick))
      .then(
        () => {},
        (error: unknown) => {
          if (!(error instanceof StepSkipped)) run.failed.set(i, errorKind(error));
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

  /** Step `i` is done with this head: it ran, or a newer head took its turn. */
  #close(run: Run, i: number) {
    run.open--;
    // The head is served once the steps requests depend on have settled, failed or not.
    if (this.#options.steps[i]?.beforePublish && --run.waiting === 0)
      this.#publish(run.observation);
    if (run.open === 0) this.#finish(run);
  }

  #finish(run: Run) {
    // Settings changed meanwhile: nothing of this tick is reported.
    if (!this.#current()) return;
    // Every step went to a newer head: this one was never ticked.
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

// safeInfo entries are re-read this long before they would expire, so requests keep hitting.
const SAFE_INFO_REFRESH_BEFORE_MS = 60_000;
// While idle, governance read at the previous block is not read again at this one, unless it
// would run out before the next block's read (a slot plus this) could replace it.
const GOVERNANCE_IDLE_MARGIN_MS = 4_000;
// ...and when no block comes in time, it is read again this long before it runs out.
const GOVERNANCE_KEEPALIVE_LEAD_MS = 3_000;
// While the vetoable L2 proposals are being viewed, Era is read again this long after the last
// read (an L1 tick's, or this loop's), so its head (served for 4 s) never runs out between L1
// blocks.
const L2_REFRESH_MS = 3_000;

export type GovernancePlan = {
  /** Someone is using the app: read at every block. */
  viewing: boolean;
  /** The new head's number. */
  head: bigint;
  /** The block of the engine's last governance read that was stored, or null. */
  lastRead: bigint | null;
  /** How much longer the cached governance is served (remainingMs), or null when none is. */
  remainingMs: number | null;
  /** The chain's slot length, or null without a slot schedule (then 12 s is assumed). */
  slotMs: number | null;
};

/**
 * Whether a tick reads governance again. Every block while the app is in use; while idle at most
 * every second block, but never letting the value run out: a head right after the block it was
 * read at skips the read only while it will still be served when the next block's read lands.
 */
export function governanceDue({
  viewing,
  head,
  lastRead,
  remainingMs,
  slotMs,
}: GovernancePlan): boolean {
  if (viewing || lastRead === null || remainingMs === null) return true;
  // Not read at the block just before (or this head is not above it: a reorg): read now.
  if (head <= lastRead || head - lastRead >= 2n) return true;
  return remainingMs < (slotMs ?? 12_000) + GOVERNANCE_IDLE_MARGIN_MS;
}

/**
 * The steps of a tick on the live modules. Each writes only while the settings it ran for are
 * still current, and only to the entries requests read.
 */
export function liveSteps(): TickStep[] {
  const terminal: TerminalIds = { ids: new Map(), finalReadsFrom: 0n };
  // The engine's governance reads that were stored: the last one's block, and how many.
  const stored = { block: null as bigint | null, count: 0 };
  // Whether a tick reads governance, decided once per tick by the first step that asks.
  const plans = new WeakMap<Tick, boolean>();
  const readsGovernance = (tick: Tick) => {
    let read = plans.get(tick);
    if (read === undefined) {
      read = governanceDue({
        viewing: tick.viewing,
        head: tick.head.number,
        lastRead: stored.block,
        remainingMs: remainingMs(GOVERNANCE_KEY),
        slotMs: tick.slotMs,
      });
      plans.set(tick, read);
    }
    return read;
  };
  // One governance read per tick (when it reads one), shared by the steps that need it, with the
  // time it arrived (its 30 s count from then, as cached() counts them). A tick that does not read
  // it hands the steps the value served now.
  const governanceOf = new WeakMap<Tick, Promise<{ value: Governance; at: number }>>();
  const governanceFor = (tick: Tick) => {
    let read = governanceOf.get(tick);
    if (!read) {
      read = (readsGovernance(tick) ? readGovernance(tick.head) : governance()).then((value) => ({
        value,
        at: Date.now(),
      }));
      governanceOf.set(tick, read);
    }
    return read;
  };
  // Idle, after a skipped read: if no block comes before the value would run out, it is read
  // again at the head served then, as a request would read it, and again before that read runs
  // out, for as long as no tick stores a newer one (a stalled chain, failing head polls). A read
  // that fails stops it: requests then read on demand, and the next tick reads it again.
  let keepAlive: ReturnType<typeof setTimeout> | null = null;
  const keepGovernanceAlive = (tick: Tick): void => {
    if (keepAlive) clearTimeout(keepAlive);
    keepAlive = null;
    const left = remainingMs(GOVERNANCE_KEY);
    if (left === null || !Number.isFinite(left)) return;
    const reads = stored.count;
    const timer = setTimeout(
      async () => {
        keepAlive = null;
        // A newer read was stored, or the settings changed, or the engine stopped.
        if (stored.count !== reads || !tick.current()) return;
        try {
          const value = await readGovernance();
          const at = Date.now();
          if (stored.count !== reads || !tick.current()) return;
          replace(GOVERNANCE_KEY, value, GOVERNANCE_TTL_MS - (Date.now() - at));
          stored.count++;
        } catch {
          // Requests read it on demand once it runs out, as without the engine.
          return;
        }
        // Kept alive again before this read runs out (in place of any timer a skipped tick armed
        // meanwhile: it counted the reads before this one, so it would do nothing).
        if (tick.current()) keepGovernanceAlive(tick);
      },
      Math.max(0, left - GOVERNANCE_KEEPALIVE_LEAD_MS)
    );
    (timer as { unref?: () => void }).unref?.();
    keepAlive = timer;
  };

  // Era between L1 blocks: re-armed by every refresh, stopped by the first that has nothing to
  // do (not viewed lately, or nobody using the app), fails, or finds the engine stopped.
  let l2Timer: ReturnType<typeof setTimeout> | null = null;
  const followL2 = (tick: Tick) => {
    if (l2Timer) clearTimeout(l2Timer);
    const timer = setTimeout(async () => {
      if (l2Timer === timer) l2Timer = null;
      if (!tick.inUse()) return;
      const refreshed = await refreshVetoableL2().catch(() => false);
      if (refreshed && tick.inUse() && l2Timer === null) followL2(tick);
    }, L2_REFRESH_MS);
    (timer as { unref?: () => void }).unref?.();
    l2Timer = timer;
  };

  return [
    // (a) The handler's log index reads the tail for this head now, before any request asks.
    {
      name: "index",
      beforePublish: true,
      run: async (tick) => puhIndex().syncHead({ head: tick.head, safe: await tick.boundary() }),
    },
    // (b) Governance, re-read at this head (while idle, at most every second head, see
    // governanceDue); on failure the last good value stays for its 30 s. Stored once this head is
    // served, so the latest block it reports is never ahead of the head requests read; not at all
    // when the head was replaced before it was served. Served for 30 s from the read's answer,
    // never longer because the head was served later (replace() stores nothing once that time has
    // passed).
    {
      name: "governance",
      run: async (tick) => {
        if (!readsGovernance(tick)) {
          keepGovernanceAlive(tick);
          throw new StepSkipped("idle: read at the previous block, still served");
        }
        const { value, at } = await governanceFor(tick);
        if (!(await tick.served())) throw new StepSkipped("head replaced before it was served");
        if (!tick.current()) return;
        replace(GOVERNANCE_KEY, value, GOVERNANCE_TTL_MS - (Date.now() - at));
        stored.block = tick.head.number;
        stored.count++;
      },
    },
    // (c) upgradeState and upgradeStatus of every id the index knows, at this block.
    { name: "status", beforePublish: true, run: (tick) => seedStatuses(tick, terminal) },
    // (d) Member Safes' info, before it expires.
    {
      name: "safes",
      run: async (tick) => {
        const { value: gov } = await governanceFor(tick).catch(() => {
          throw new StepSkipped("governance unavailable");
        });
        const due = governanceSafes(gov).filter((safe) => {
          const left = remainingMs(safeInfoKey(safe));
          return left === null || left < SAFE_INFO_REFRESH_BEFORE_MS;
        });
        await Promise.all(
          due.map(async (safe) => {
            const info = await readSafeInfo(safe);
            if (tick.current()) replace(safeInfoKey(safe), info, SAFE_INFO_TTL_MS);
          })
        );
      },
    },
    // (e) The signature sets pages viewed, verified at this head once it is served (after its
    // governance read and upgrade states), so the next request finds them: while the app is in
    // use, those viewed in the last 10 minutes and the open ones; while idle, the open ones.
    signaturesStep((tick) => governanceFor(tick)),
    // (f) ZKsync Era, when the vetoable L2 proposals were viewed in the last 10 minutes (and the
    // app is in use): Era's head, the L2 governor index's tail at it and those proposals' states,
    // read now and then every 3 s until the next L1 block, so requests find them in memory (Era's
    // head is served for 4 s).
    {
      name: "l2",
      run: async (tick) => {
        if (!tick.viewing) throw new StepSkipped("idle");
        if (!(await refreshVetoableL2()))
          throw new StepSkipped("L2 proposals not viewed lately, or not indexed");
        if (tick.current()) followL2(tick);
      },
    },
  ];
}

/** The precompute could not verify some watched sets (an upstream error); nothing of them is kept. */
class PrecomputeFailed extends Error {
  override name = "PrecomputeFailed";
}

/**
 * The tick step that verifies watched signature sets at the new head, after `after(tick)` settled
 * and the head was served (requests then read at it): while the app is in use, those viewed in the
 * last 10 minutes and the open ones; while idle, only the open ones. Sets that would need Safe (no
 * listing at most 60 s old) are left to requests.
 */
export function signaturesStep(after: (tick: Tick) => Promise<unknown> = async () => {}): TickStep {
  return {
    name: "signatures",
    run: async (tick) => {
      await after(tick).catch(() => {});
      if (!(await tick.served())) throw new StepSkipped("head replaced before it was served");
      if (!tick.current()) return;
      const run = await precomputeSignatureSets(tick.head, {
        current: tick.current,
        viewing: tick.viewing,
      });
      if (run.failed > 0) throw new PrecomputeFailed(`${run.failed} of ${run.sets} sets failed`);
    },
  };
}

/**
 * Ids seen in a state that never changes again (executed, or expired without approval): the
 * value, the head it was read at, and whether a read at a FINAL block confirmed it. Only a
 * confirmed one is carried forward without reading: a read at a head that was then reorged away
 * says nothing about the canonical chain, even once the boundary passes its height.
 */
type TerminalIds = {
  ids: Map<string, { value: UpgradeStatusRead; block: bigint; final: boolean }>;
  /** No read at the boundary before this head: one failed (see FINAL_READ_RETRY_BLOCKS). */
  finalReadsFrom: bigint;
};

// The boundary is often ~100 blocks deep, past the state a non-archive node keeps (Geth and
// Nethermind full nodes: 128 blocks, less while finality lags). There a read at the boundary
// fails, and the ids it would have confirmed are read at the head like the others; the
// boundary is asked again this many blocks later.
const FINAL_READ_RETRY_BLOCKS = 32n;

async function seedStatuses(tick: Tick, terminal: TerminalIds): Promise<void> {
  const index = puhIndex();
  // Lists wait for the backfill; the engine does not.
  if (index.status().state !== "ready") throw new StepSkipped("index not ready");
  const safe = await tick.boundary();
  // The ids the index knows at this head (it is not served yet, so it is named explicitly).
  const at = { waitMs: 0, head: { head: tick.head, safe } };
  const [net, started, executed] = await Promise.all([
    network(),
    index.events("UpgradeStarted", at),
    index.events("EmergencyUpgradeExecuted", at),
  ]);
  if (!tick.current()) return;
  const ids = new Map<string, Hex>();
  for (const { args } of [...started, ...executed]) ids.set(args._id.toLowerCase(), args._id);
  // Issued together: the reads at one block go out as one Multicall3 call (one for the head,
  // one for the boundary when terminal states are being confirmed).
  await Promise.all(
    [...ids].map(async ([key, id]) => {
      const known = terminal.ids.get(key);
      if (
        known &&
        !known.final &&
        known.block <= safe &&
        tick.head.number >= terminal.finalReadsFrom
      ) {
        // The boundary has passed the head it was read at: read it once at the boundary, which
        // never changes. Still terminal there: terminal for good. This only saves reads: when
        // the node cannot answer there, the id is read at the head below, as any other.
        const atFinal = await readUpgradeStatus(net.upgradeHandler, id, safe).catch(() => null);
        if (!tick.current()) return;
        if (atFinal === null) {
          const retryFrom = tick.head.number + FINAL_READ_RETRY_BLOCKS;
          if (retryFrom > terminal.finalReadsFrom) terminal.finalReadsFrom = retryFrom;
        } else if (isTerminalState(atFinal.state))
          terminal.ids.set(key, { ...known, value: atFinal, final: true });
        else terminal.ids.delete(key);
      }
      const confirmed = terminal.ids.get(key);
      if (confirmed?.final) {
        seedUpgradeStatus(net, id, tick.head, confirmed.value);
        return;
      }
      const value = await upgradeStatusAt(net, id, tick.head);
      if (isTerminalState(value.state) && tick.current() && !terminal.ids.has(key))
        terminal.ids.set(key, { value, block: tick.head.number, final: false });
    })
  );
}

let instance: SyncEngine | null = null;

/** The engine for the current settings; a settings change retires the old one. */
function engine(): SyncEngine {
  const generation = rpcGeneration();
  if (instance?.generation === generation) return instance;
  const previous = instance;
  previous?.stop();
  const next = new SyncEngine({
    mode: env.SYNC_MODE,
    keepWarmMs: env.SYNC_KEEPWARM_MS,
    generation,
    lastTouch: previous?.lastTouch ?? null,
    currentGeneration: rpcGeneration,
    network,
    pollHead,
    steps: liveSteps(),
    onSuperseded: () => {
      engine().resume();
    },
  });
  instance = next;
  return next;
}

// The Safe store's background sweep runs while the engine does (safe/store.ts decides what, and
// whether this Safe service may be read in the background at all): the groups pages asked for
// while the app is in use and, with SYNC_MODE=always, every governance member Safe at the
// quota-paced interval.
const safeSweep: SafeSweepDriver = {
  active: () => instance !== null && instance.generation === rpcGeneration() && instance.active,
  viewing: () => instance?.viewing ?? false,
  baseline: () => instance?.mode === "always",
  groups: async () => {
    const gov = await governance();
    return {
      securityCouncil: gov.securityCouncil.members,
      guardians: gov.guardians.members,
      zkFoundation: [gov.emergencyUpgradeBoard.zkFoundation],
    };
  },
};

// Watched signature sets are verified again at the served head when a member Safe's listing
// changes, while the engine runs (only the open ones while idle).
const signatureWatch: SignatureWatchDriver = {
  active: safeSweep.active,
  viewing: () => instance?.viewing ?? false,
  head: servedHead,
};

function startDrivers() {
  startSafeSweep(safeSweep);
  startSignatureWatch(signatureWatch);
}

// Reads of the app's own status: AGENTS.md's first command, monitors, the header's indexing poll.
const STATUS_PATHS = new Set(["/api/status"]);

/**
 * Whether a request to `path` is a visit: someone using the app, which switches the engine to the
 * full profile for SYNC_KEEPWARM_MS (and in "window" mode starts it). A read of /api/status is
 * not: polling it would otherwise keep the full profile running, and the status would always
 * report itself as the visitor (`sync.engine.cost.mode` "viewing", the idle cost never seen).
 * Paths match as the router matches them: case aside, and with or without a trailing slash.
 */
export function countsAsVisit(path: string): boolean {
  const route = path.toLowerCase().replace(/\/+$/, "");
  return !STATUS_PATHS.has(route);
}

/**
 * Marks a request to `path` (any request when omitted). A visit (countsAsVisit) keeps the engine
 * running in the full profile, or starts it; a status read only resumes an engine that should
 * already be running (SYNC_MODE=always, or "window" within SYNC_KEEPWARM_MS of a visit), and
 * leaves the profile as it is. Never throws.
 */
export function touchSync(path?: string) {
  try {
    const current = engine();
    if (path === undefined || countsAsVisit(path)) current.touch();
    else current.resume();
    startDrivers();
  } catch (error) {
    log.warn({ error: errorKind(error) }, "sync touch failed");
  }
}

/**
 * Starts the engine after the server starts listening, and after a settings change (the old
 * engine's reads are dropped). In "always" mode it simply starts following the head (nobody is
 * viewing yet); in "window" mode the start counts as activity, as before: it runs for
 * SYNC_KEEPWARM_MS, then waits for requests. Never throws.
 */
export function startSync() {
  try {
    const current = engine();
    if (env.SYNC_MODE === "always") current.resume();
    else current.touch();
    startDrivers();
  } catch (error) {
    log.warn({ error: errorKind(error) }, "sync start failed");
  }
}

/** What the engine is doing, for /api/status. */
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
    // No engine yet: no request has been made since the settings were applied.
    cost: { ...upstreamCost(), mode: "idle" },
  };
}

/** Stops the engine (tests, shutdown). The next request starts a new one. */
export function stopSync() {
  instance?.stop();
  instance = null;
  stopSafeSweep();
  stopSignatureWatch();
}
