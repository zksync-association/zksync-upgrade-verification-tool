import { defaultLogger } from "@config/log.server";
import { env } from "@config/env.server";
import type { Hex } from "viem";
import { remainingMs, replace } from "../cache";
import { puhIndex } from "../chain/puh-index";
import {
  GOVERNANCE_KEY,
  GOVERNANCE_TTL_MS,
  type Governance,
  SAFE_INFO_TTL_MS,
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
} from "../rpc";
import {
  type UpgradeStatusRead,
  isTerminalState,
  readUpgradeStatus,
  seedUpgradeStatus,
  upgradeStatusAt,
} from "../upgrade-status";

// The sync engine: while the app is in use it follows the chain head and, on every new block,
// refills the same cache entries requests read (the head, governance, upgrade states, Safe info),
// so a request finds them fresh and asks nothing upstream. It never serves anything itself: when
// it is idle, failing or off, requests read on demand exactly as without it, with the same
// lifetimes (head 4 s, governance 30 s). State read at the head is keyed by the head's hash.
//
// A new head is served (published as the cached head) once what requests at it need has been
// read (the index tail, upgrade states), at most 2 s after it was seen, and only while it is still
// the head the engine follows. Until then requests keep the previous head, within its own 4 s
// since it was last confirmed (at once instead when the previous head was confirmed by the clock
// and those confirmations may have been wrong). Each step runs on its own: a slow step for one
// head delays only that step's next run, never the other steps of newer heads.
//
// Timers are unref'd and stop when nobody has made a request for SYNC_KEEPWARM_MS. Nothing here
// logs an error's text: it can carry the RPC URL and its key.

export type SyncMode = "window" | "always" | "off";

export type SyncEngineStatus = {
  /** "off" also for dev nodes, which always read on demand (see `reason`). */
  mode: SyncMode;
  /** Why the engine is off, or null. */
  reason: string | null;
  /** Following the head right now (false while idle). */
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
};

/** What a tick's steps get: the new head, and whether the settings are still the ones it ran for. */
export type Tick = {
  head: BlockRef;
  generation: number;
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
    if (this.#options.mode === "always") return true;
    return this.#lastTouch !== null && this.#now() - this.#lastTouch <= this.#options.keepWarmMs;
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

/**
 * The steps of a tick on the live modules. Each writes only while the settings it ran for are
 * still current, and only to the entries requests read.
 */
export function liveSteps(): TickStep[] {
  const terminal: TerminalIds = { ids: new Map(), finalReadsFrom: 0n };
  // One governance read per tick, shared by the steps that need it, with the time it arrived
  // (its 30 s count from then, as cached() counts them).
  const governanceOf = new WeakMap<Tick, Promise<{ value: Governance; at: number }>>();
  const governanceFor = (tick: Tick) => {
    let read = governanceOf.get(tick);
    if (!read) {
      read = readGovernance(tick.head).then((value) => ({ value, at: Date.now() }));
      governanceOf.set(tick, read);
    }
    return read;
  };

  return [
    // (a) The handler's log index reads the tail for this head now, before any request asks.
    {
      name: "index",
      beforePublish: true,
      run: async (tick) => puhIndex().syncHead({ head: tick.head, safe: await tick.boundary() }),
    },
    // (b) Governance, re-read at this head; on failure the last good value stays for its 30 s.
    // Stored once this head is served, so the latest block it reports is never ahead of the head
    // requests read; not at all when the head was replaced before it was served. Served for 30 s
    // from the read's answer, never longer because the head was served later (replace() stores
    // nothing once that time has passed).
    {
      name: "governance",
      run: async (tick) => {
        const { value, at } = await governanceFor(tick);
        if (!(await tick.served())) throw new StepSkipped("head replaced before it was served");
        if (tick.current()) replace(GOVERNANCE_KEY, value, GOVERNANCE_TTL_MS - (Date.now() - at));
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
  ];
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

/** Marks a request: keeps the engine running (or starts it). Never throws. */
export function touchSync() {
  try {
    engine().touch();
  } catch (error) {
    log.warn({ error: errorKind(error) }, "sync touch failed");
  }
}

/**
 * Starts the engine after the server starts listening (counts as activity: "window" mode runs
 * for SYNC_KEEPWARM_MS, then waits for requests), and after a settings change (the old engine's
 * reads are dropped). Never throws.
 */
export function startSync() {
  touchSync();
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
  };
}

/** Stops the engine (tests, shutdown). The next request starts a new one. */
export function stopSync() {
  instance?.stop();
  instance = null;
}
