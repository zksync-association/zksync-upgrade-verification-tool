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

// The sync engine follows the chain head and, on every new block, refills the same cache entries
// requests read (the head, upgrade states, pages' governance at the head, the Safe info and
// signature sets on screen), so a request finds them fresh and asks nothing upstream. What changes
// from block to block is read AT each block, in as few combined calls as possible (the snapshot,
// sync/snapshot.ts, and the sets' verdicts share the head's aggregate3, chain/aggregate.ts), and
// nothing is carried from the block before. It never serves anything itself: when it is stopped,
// failing or off, requests read on demand exactly as without it, with the same lifetimes (head
// 4 s, governance 30 s). State read at the head is keyed by the head's hash. Its own upstream
// work is paced (sync/pacer.ts, SYNC_CREDITS_PER_SECOND).
//
// SYNC_MODE=window (the default) follows the head only while someone uses the app (presence.ts: a
// visible tab's beat, or a page load, within SYNC_KEEPWARM_MS); nobody using it, it sends nothing
// upstream at all, and the next use starts it again. "always" follows the head for as long as the
// process runs, and does less while nobody uses the app, within the same bounds: governance is
// read at most every second block (never past its 30 s). Either way what is on screen (the
// signature sets, their member Safes, ZKsync Era) is read only while it is. JSON (/api/*) and
// /api/status never count as use: they read on demand.
//
// After each served head, what is on screen is digested from memory (sync/content.ts), so an open
// page whose content changed learns it from its next beat (sync/revs.ts) and reloads from memory.
// The member Safes the screen depends on are checked by the Safe store's watcher, ZKsync Era by
// the Era timer (sync/era.ts); both run only while someone uses the app.
//
// A new head is served (published as the cached head) once what requests at it need has been
// read (the index tail, upgrade states, and the signature sets on screen, verified at
// it), at most 2 s after it was seen, and only while it is still the head the engine follows.
// Until then requests keep the previous head, within its own 4 s since it was last confirmed (at
// once instead when the previous head was confirmed by the clock and those confirmations may have
// been wrong). Each step runs on its own: a slow step for one head delays only that step's next
// run, never the other steps of newer heads.
//
// Timers are unref'd; in "window" mode they stop at the first wake (at most 2 s) after nobody uses
// the app, and a poll answered after that starts nothing. Nothing here logs an error's text: it
// can carry the RPC URL and its key.

export type SyncMode = "window" | "always" | "off";

export type SyncEngineStatus = {
  /** "off" also for dev nodes, which always read on demand (see `reason`). */
  mode: SyncMode;
  /** Why the engine is off, or null. */
  reason: string | null;
  /**
   * Following the head right now. With SYNC_MODE=always: for as long as the process runs, in use
   * or idle (`cost.mode` tells which); with "window": only while the app is in use (false in a
   * session that only reads JSON).
   */
  active: boolean;
  /**
   * The newest head the engine has seen; ageMs is the time since it was last confirmed. servedAt:
   * when requests started to read it (null until then, and for good when it was replaced first).
   */
  head: {
    number: string;
    hash: Hex;
    observedAt: string;
    confirmedAt: string;
    servedAt: string | null;
    ageMs: number;
  } | null;
  /** The last finished tick: the block, how long its steps took, and the steps that failed. */
  lastTick: { block: string; ms: number; failedSteps: string[] } | null;
  polls: number;
  ticks: number;
  /**
   * What the app asked upstream in the last hour (requests and background work alike), and
   * whether someone is using the app now ("viewing": a visible tab's beat or a page load within
   * SYNC_KEEPWARM_MS, see sync.presence; JSON and /api/status never count) or not.
   * `infuraCreditsPerHour` is an estimate (see creditsBasis); `pacer` is the engine's own pace.
   */
  cost: UpstreamCost & {
    mode: "viewing" | "idle";
    pacer: ReturnType<ReturnType<typeof pacer>["status"]>;
  };
  /** How the head follower times its polls (SYNC_HEAD_POLL), and what it saw lately. */
  clock: HeadClockStatus;
};

/** How the follower looks for the next block after the one it follows (SYNC_HEAD_POLL). */
export type HeadPoll = "slot" | "late";

export type HeadClockStatus = {
  /**
   * "slot": a poll when the next block's slot begins (the proof that the local clock is not
   * behind), then every second; "late": the same proof poll, then the first search poll
   * `firstPollMs` into the slot (learned from when blocks arrived), then every second.
   */
  headPoll: HeadPoll;
  /** The first search poll's offset into the slot ("late"), or null. */
  firstPollMs: number | null;
  /** Arrival offsets learned from (polled every second from the slot's start), and the poll RTT. */
  samples: number;
  rttP95Ms: number | null;
  /** The last heads (at most 64) that followed the one before: polls, when seen and served. */
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

/** What a tick's steps get: the new head, and whether the settings are still the ones it ran for. */
export type Tick = {
  head: BlockRef;
  generation: number;
  /**
   * The full profile applies: someone was using the app when the head was seen (presence.ts).
   * Always true in "window" mode, which runs only then.
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
  /** Someone is using the app now (presence.ts). */
  inUse: () => boolean;
  generation: number;
  now?: () => number;
  /** The current settings generation (rpc.ts). */
  currentGeneration: () => number;
  network: () => Promise<Pick<Network, "isDevNode" | "name" | "blockTimeSeconds">>;
  pollHead: (options: { withFinalized: boolean }) => Promise<PolledHead>;
  steps: readonly TickStep[];
  /** Called when this engine finds that the settings changed (it has stopped itself). */
  onSuperseded?: () => void;
  /** How the follower looks for the next block (default "slot"). */
  headPoll?: HeadPoll;
  /**
   * The wait (null: none) before a head poll, asking `withFinalized` or not (the credit pacer,
   * sync/pacer.ts). Waited before the read is made, so a request never joins a poll that waits.
   */
  pacePoll?: (withFinalized: boolean) => Promise<void> | null;
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
  /**
   * The next slot is searched every second from its start (always with "slot"; with "late", on
   * the slots it learns arrival times from).
   */
  calibrating: boolean;
  /** Head polls sent when it was seen (for polls per block). */
  pollsAtSeen: number;
  /** Its publication point passed (its tick read what requests need, or the deadline). */
  published: boolean;
  /** When it was served; null until then, or when it never was. */
  servedAt: number | null;
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

// "late" (SYNC_HEAD_POLL): the first search poll goes this far into the slot until enough
// arrivals were seen, and never earlier than 1 s or later than leaves the head served (4 s from
// the proof poll's answer) with half a second to spare after the slowest polls.
const LATE_DEFAULT_MS = 2_500;
const LATE_MIN_MS = 1_000;
const LATE_HEAD_TTL_MS = 4_000;
const LATE_MARGIN_MS = 500;
const LATE_PERCENTILE = 0.8;
// Arrival offsets are learned from slots searched every second from their start: the first
// slots, then one in this many.
const LATE_LEARN_FIRST = 8;
const LATE_LEARN_EVERY = 8;
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

/** What the follower learns about when blocks arrive, and reports (HeadClockStatus). */
class HeadClock {
  readonly mode: HeadPoll;
  readonly #arrivals: number[] = [];
  readonly #rtts: number[] = [];
  readonly #recent: {
    number: bigint;
    timestampMs: number;
    seenOffsetMs: number;
    polls: number | null;
    servedDelayMs: number | null;
    servedOffsetMs: number | null;
  }[] = [];
  #seen = 0;

  constructor(mode: HeadPoll) {
    this.mode = mode;
  }

  /** Whether the slot after the head seen now is searched every second from its start. */
  calibrating(): boolean {
    if (this.mode === "slot") return true;
    return this.#arrivals.length < LATE_LEARN_FIRST || this.#seen % LATE_LEARN_EVERY === 0;
  }

  /** The first search poll's offset into the slot ("late"). */
  firstPollMs(): number {
    const rtt = this.#rtts.length > 0 ? quantile(this.#rtts, 0.95) : 0;
    const upper = Math.max(LATE_MIN_MS, LATE_HEAD_TTL_MS - rtt - LATE_MARGIN_MS);
    const learned =
      this.#arrivals.length > 0 ? quantile(this.#arrivals, LATE_PERCENTILE) : LATE_DEFAULT_MS;
    return Math.round(Math.min(upper, Math.max(LATE_MIN_MS, learned)));
  }

  noteRtt(ms: number) {
    if (ms >= 0) keepLast(this.#rtts, ms, KEEP_SAMPLES);
  }

  /**
   * A head seen (by a poll sent at `sentAt`), after `previous`: what it shows about arrivals
   * (only when the slot was searched every second from its start, and it is the next block),
   * and for the report.
   */
  noteSeen(
    head: BlockRef,
    previous: { head: BlockRef; calibrating: boolean; pollsAtSeen: number } | null,
    sentAt: number,
    now: number,
    polls: number,
    slotMs: number | null
  ) {
    this.#seen++;
    const timestampMs = Number(head.timestamp) * 1000;
    const next = previous !== null && head.number === previous.head.number + 1n;
    if (
      next &&
      previous.calibrating &&
      slotMs !== null &&
      Number(head.timestamp - previous.head.timestamp) * 1000 === slotMs &&
      sentAt >= timestampMs &&
      sentAt - timestampMs < slotMs
    )
      keepLast(this.#arrivals, sentAt - timestampMs, KEEP_SAMPLES);
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
      headPoll: this.mode,
      firstPollMs: this.mode === "late" ? this.firstPollMs() : null,
      samples: this.#arrivals.length,
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

/** What a tab's beat is told about the heads served (SyncEngine.view). */
export type EngineView = {
  /** The newest head served, or null before the first. */
  head: BlockRef | null;
  /** When it was served (ms since the epoch), or null. */
  servedAt: number | null;
  /** The head served before it, or null. */
  previous: BlockRef | null;
  /** The engine has just started and is still reading the blocks it missed. */
  catchingUp: boolean;
};

export class SyncEngine {
  readonly generation: number;
  readonly #options: SyncEngineOptions;
  readonly #now: () => number;
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
  // The newest head served (and when), the one served before it, and whether one was served
  // since the engine last started.
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
    this.#clock = new HeadClock(options.headPoll ?? "slot");
  }

  /** Following the head right now (false while stopped for inactivity, off, or retired). */
  get active(): boolean {
    return this.#running;
  }

  /** Someone is using the app (presence.ts). */
  get viewing(): boolean {
    return this.#options.inUse();
  }

  get mode(): SyncMode {
    return this.#offReason === null ? this.#options.mode : "off";
  }

  /**
   * Starts following the head when the engine should be running and is not (someone uses the
   * app, or SYNC_MODE=always). The request that woke it reads on demand meanwhile.
   */
  resume() {
    if (this.#running || this.#stopped || this.#offReason !== null) return;
    if (!this.#active()) return;
    this.#running = true;
    this.#servedSinceStart = false;
    this.#schedule(0);
  }

  /**
   * For a tab's beat, from memory: the newest head served (null before the first), and whether
   * the engine has just started and not served a head yet (the missed blocks are being read).
   */
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
    // The engine's work still waiting its turn is never sent (R-D3).
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

  /** The engine should be following the head: always, or while someone uses the app. */
  #active() {
    return this.#options.mode === "always" || this.#options.inUse();
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
    // Nobody uses the app: every timer stops; the next use starts the engine again.
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
    if (!this.#running) return;
    // Use ended while the poll was out (its answer started nothing): stop now, not a wake later.
    if (!this.#active()) {
      this.#pause();
      return;
    }
    this.#schedule(this.#nextDelay());
  }

  /** Stops following the head until the next use (see resume). */
  #pause() {
    this.#running = false;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
    // The engine's work still waiting its turn is never sent (R-D3: nothing is read once use
    // has ended).
    pacer().drop();
    // The head after the pause is found by a poll sent at no particular moment: no sign either
    // way about the clock (see #observe), and no clock confirmations until a poll proves it.
    if (this.#observed) this.#observed.slotConfirm = false;
  }

  #nextDelay(): number {
    const seen = this.#observed;
    if (!this.#lastPollOk || !seen || seen.nextSlotAt === null || !this.#slotMs) return POLL_MS;
    const now = this.#now();
    // Before the next slot: confirmations (or polls, without the clock's proof) every 2 s, the
    // last one exactly when the slot begins. A poll then that still finds this head is the proof
    // that lets the next head be confirmed by the clock.
    if (now < seen.nextSlotAt) return Math.min(CONFIRM_EVERY_MS, seen.nextSlotAt - now);
    if (now < seen.nextSlotAt + this.#slotMs) {
      // "late": after the proof poll at the slot's start, the first search poll goes where most
      // blocks have arrived by (see HeadClock); every second from then on.
      if (this.#clock.mode === "late" && !seen.calibrating) {
        const first = seen.nextSlotAt + this.#clock.firstPollMs();
        if (now < first) return first - now;
      }
      return SLOT_POLL_MS;
    }
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
    // The engine's own requests keep to their pace (sync/pacer.ts), waited for before the read is
    // made: a request reading the head meanwhile reads it itself, never behind this wait.
    const wait = this.#options.pacePoll?.(withFinalized) ?? null;
    if (wait) {
      try {
        await wait;
      } catch {
        // Dropped unsent: the engine may no longer send (sync/pacer.ts).
        return;
      }
      // Use may have ended while the poll waited its turn: then it is never sent (R-D3).
      if (!this.#running || !this.#current() || !this.#active()) return;
    }
    const askedAt = this.#now();
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
    // Use ended while the poll was out: its answer starts no tick (and nothing reads it here).
    if (!this.#active()) return;
    // A poll that joined a head read already in flight (a request's) was sent when that read was:
    // the clock's proof (see #observe) counts from the moment the node was asked.
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

  /** `sentAt`: when the poll that named `polled` was sent; `previous`: the poll answered before. */
  #observe(polled: PolledHead, previous: PollRecord | null, sentAt: number) {
    const now = this.#now();
    const seen = this.#observed;
    if (seen && seen.polled.head.hash === polled.head.hash) {
      // The node named the same head again: a real confirmation, once it is served (for 4 s
      // from this answer).
      seen.polled = polled;
      if (seen.published && polled.publish()) {
        seen.confirmedAt = polled.answeredAt;
        // Resumed at the head served before the pause: nothing was missed.
        this.#servedSinceStart = true;
      }
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
    this.#clock.noteSeen(
      polled.head,
      seen && {
        head: seen.polled.head,
        calibrating: seen.calibrating,
        pollsAtSeen: seen.pollsAtSeen,
      },
      sentAt,
      now,
      this.#polls,
      slotMs ?? null
    );
    const observation: Observation = {
      seq: ++this.#seq,
      polled,
      observedAt: now,
      confirmedAt: polled.answeredAt,
      nextSlotAt: onSchedule && slotMs ? timestampMs + slotMs : null,
      slotConfirm: onSchedule && proven && now >= this.#distrustClockUntil,
      calibrating: this.#clock.calibrating(),
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
      viewing: this.#options.inUse(),
      inUse: () => this.#current() && this.#running && this.#options.inUse(),
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
      .then(() => {
        // Use ended since the head was seen (this step waited for an older head's run): nothing
        // more is read for it.
        if (!this.#active()) throw new StepSkipped("not in use");
        // The engine's own work: paced (sync/pacer.ts).
        return asEngineWork(() => step.run(run.tick));
      })
      .then(
        () => {},
        (error: unknown) => {
          // Use ended while it ran: what it had not sent yet was dropped (sync/pacer.ts), and
          // nothing it read is shown; not a failure of the data source.
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
  const snapshot = snapshotState();
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
  // One governance read per tick (when it reads one), with the time it arrived (its 30 s count
  // from then, as cached() counts them). `shared`: it is the read requests share (governance()'s
  // single flight), already stored as they store it, because none was served when the tick
  // started or one was in flight then (a request's, right after a pause): never a second read
  // beside it. With none in flight and no head in memory either (a resume woken by a tab's beat
  // alone), that read is started at the tick's head: governance() would read the head once more
  // (requests read a fresh head then too, so it is never ahead of theirs). Otherwise a tick that
  // reads governance reads it at its head, stored once the head is served (requests keep the
  // value served meanwhile), and one that does not hands the steps the value served now.
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
      const shared = left === null || left === Number.POSITIVE_INFINITY || !readsGovernance(tick);
      read = (shared ? sharedGovernance(tick) : readGovernance(tick.head)).then((value) => ({
        value,
        at: Date.now(),
        shared,
      }));
      governanceOf.set(tick, read);
    }
    return read;
  };
  // Idle, after a skipped read: if no block comes before the value would run out, it is read
  // again at the head served then, as a request would read it, and again before that read runs
  // out, for as long as no tick stores a newer one (a stalled chain, failing head polls). A read
  // that fails stops it: requests then read on demand, and the next tick reads it again. Once the
  // governance split applies there is nothing to keep fresh (see the step), and it stops.
  let keepAlive: ReturnType<typeof setTimeout> | null = null;
  const stopKeepAlive = (): void => {
    if (keepAlive) clearTimeout(keepAlive);
    keepAlive = null;
  };
  const keepGovernanceAlive = (tick: Tick): void => {
    stopKeepAlive();
    const left = remainingMs(GOVERNANCE_KEY);
    if (left === null || !Number.isFinite(left)) return;
    const reads = stored.count;
    const timer = setTimeout(
      async () => {
        keepAlive = null;
        // A newer read was stored, or the settings changed, or the engine stopped.
        if (stored.count !== reads || !tick.current()) return;
        // Pages read governance at each head now; JSON reads its own on demand.
        if (await governanceSplit()) return;
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
    // passed). With nothing served (right after a pause) or a read in flight, the tick shares
    // governance()'s read instead (see governanceFor), which requests share too.
    {
      name: "governance",
      run: async (tick) => {
        // Where the code is pinned, pages read governance at each head in the snapshot (sync/
        // snapshot.ts) and JSON reads it on demand: nothing to keep fresh here.
        if (await governanceSplit()) {
          // A keep-alive armed by an idle tick before the split was known would otherwise read
          // in full for as long as the engine runs (nothing stored under the split stops it).
          stopKeepAlive();
          throw new StepSkipped("pages read governance at each head (snapshot)");
        }
        if (!readsGovernance(tick)) {
          keepGovernanceAlive(tick);
          throw new StepSkipped("idle: read at the previous block, still served");
        }
        const { value, at, shared } = await governanceFor(tick);
        if (!shared) {
          if (!(await tick.served())) throw new StepSkipped("head replaced before it was served");
          if (!tick.current()) return;
          replace(GOVERNANCE_KEY, value, GOVERNANCE_TTL_MS - (Date.now() - at));
        } else if (!tick.current()) return;
        stored.block = tick.head.number;
        stored.count++;
      },
    },
    // (c) The snapshot: what pages show that can change from one block to the next, read at
    // this block in its aggregate3 (sync/snapshot.ts): governance's values that change, and the
    // states of the ids that are not over for good and of those on screen.
    { name: "snapshot", beforePublish: true, run: (tick) => snapshotStep(tick, snapshot) },
    // (d) The info of the member Safes of the signature sets on screen, before it expires. One
    // that is not served at all is read through safeInfo(), whose read requests share; one about
    // to expire is read again ahead of them, replacing it.
    {
      name: "safes",
      run: async (tick) => {
        if (!tick.viewing) throw new StepSkipped("nothing on screen");
        const due = onScreenSafes().filter((safe) => {
          const left = remainingMs(safeInfoKey(safe));
          return left === null || left < SAFE_INFO_REFRESH_BEFORE_MS;
        });
        // Read at this head: in its aggregate3, beside the snapshot and the verdicts.
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
    // (e) The signature sets on screen, verified at this head before it is served, so the first
    // request at it finds them.
    signaturesStep(),
    // (f) The simulations pages on screen show (a transaction ready to send), simulated at this
    // head before it is served (one eth_call each, kept for the head), so a page never shows a
    // result from an older block as current, and learns from its next beat when it changed.
    {
      name: "simulations",
      beforePublish: true,
      run: async (tick) => {
        if (!tick.viewing) throw new StepSkipped("nothing on screen");
        const keys = [...presence().onScreen()].filter((key) => key.startsWith("sim:"));
        if (keys.length === 0) return;
        await resimulateOnScreen(tick.head, keys, () => tick.current() && tick.inUse());
      },
    },
    // (g) Once the head is served: what is on screen, digested from memory at it (the signature
    // sets were in (e), the simulations in (f)), so a tab whose content changed learns it from its
    // next beat; and the Safes behind the lists on screen, for the Safe watcher. ZKsync Era has
    // its own timer (sync/era.ts).
    {
      name: "content",
      run: async (tick) => {
        try {
          if (!tick.viewing) throw new StepSkipped("nothing on screen");
          // An Era page that came on screen since the last wake: its timer starts (idempotent).
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

// The member Safes of governance's signer groups, from the last governance pages read (the lists
// on screen collect from them).
let groupSafes: { council: Address[]; guardians: Address[]; foundation: Address } | null = null;

/** Reads (from memory, at the served head) the signer groups' Safes the lists collect from. */
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

/** The Safes the lists on screen collect from (emergency ids, freeze requests, vetoes). */
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

/**
 * For each list key a tab shows (pending emergency upgrades, freeze requests, vetoes): how the
 * Safes it collects from are kept ("Safe checked 2m ago · next check in 3m"). A check that finds
 * nothing new changes no list, so the page does not reload; the beat's answer moves the label.
 */
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

/** The member Safes of the signature sets on screen, each once. */
function onScreenSafes(): Address[] {
  const safes = new Map<string, Address>();
  for (const { members } of onScreenSigners())
    for (const safe of members) safes.set(safe.toLowerCase(), safe);
  return [...safes.values()];
}

/** The precompute could not verify some sets on screen (an upstream error); nothing of them is kept. */
class PrecomputeFailed extends Error {
  override name = "PrecomputeFailed";
}

/**
 * The tick step that verifies the signature sets on screen at the new head (the sets the pages
 * open in a visible tab render, and those a page load just issued; nothing while nobody uses the
 * app). Sets that would need Safe (no listing at most 60 s old) are left to requests.
 *
 * The head is served only once this step settled (beforePublish), within the same 2 s as the
 * index tail and upgrade states: served earlier, a request in the gap would find no result at the
 * new head and verify the set itself (0.3-0.5 s on mainnet), while until then requests read the
 * previous head, whose results are kept. The verdicts are read at the head's block number and kept
 * under its hash, whether or not the head is ever served: requests at another head never use them
 * (a page's first answer may show one as a set's last result, labelled with its block, as it does
 * any older result), so a head replaced before it was served only cost the reads. Nothing here
 * waits for the head to be served (it would wait for itself) or for governance: a set on screen
 * carries its members, threshold and contract.
 */
export function signaturesStep(): TickStep {
  return {
    name: "signatures",
    beforePublish: true,
    run: async (tick) => {
      if (!tick.current()) return;
      // A tick that started in use starts no more sets once that use ended (nothing is on
      // screen then); one that started idle (SYNC_MODE=always) has none to start.
      const run = await precomputeSignatureSets(tick.head, {
        current: () => tick.current() && (!tick.viewing || tick.inUse()),
        viewing: tick.viewing,
      });
      if (run.failed > 0) throw new PrecomputeFailed(`${run.failed} of ${run.sets} sets failed`);
    },
  };
}

/** Pages read governance at each head (governance.ts governanceSplitApplies). */
function governanceSplit(): Promise<boolean> {
  return governanceSplitApplies();
}

// How long a tab's beat or a page load counts as use, and the engine's pace (presence.ts and
// pacer.ts read no environment themselves).
readKeepWarmFrom(() => env.SYNC_KEEPWARM_MS);
readRateFrom(() => env.SYNC_CREDITS_PER_SECOND);

let instance: SyncEngine | null = null;

/** Someone uses the app, or the engine follows the chain under the current settings. */
function engineMaySend(): boolean {
  return (
    presence().inUse() ||
    (instance !== null && instance.generation === rpcGeneration() && instance.active)
  );
}

// The one-time check of governance's pinned code (governance.ts pinsChecked) reads only while
// someone uses the app or the engine follows the chain (R-D3: nothing reads once use has ended).
allowPinChecksWhen(engineMaySend);

// The same for the engine's own work: what waits its turn in the credit pacer past that (or past
// a settings change) is dropped unsent, and none starts meanwhile (sync/pacer.ts).
allowEngineWorkWhen({ allowed: engineMaySend, generation: rpcGeneration });

/** The engine for the current settings; a settings change retires the old one. */
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
    headPoll: env.SYNC_HEAD_POLL,
    pacePoll: (withFinalized) =>
      pacer().take(creditsOf("eth_getBlockByNumber") * (withFinalized ? 2 : 1)),
    onSuperseded: () => {
      engine().resume();
    },
  });
  instance = next;
  return next;
}

/** The engine follows the chain for the current settings. */
const engineActive = () =>
  instance !== null && instance.generation === rpcGeneration() && instance.active;

/**
 * A dev node (anvil, hardhat): the engine does not follow it (requests read at 'latest'), but the
 * Safe watcher still runs while someone uses the app, so a signature filed in Safe still reaches
 * an open page (never with SYNC_MODE=off).
 */
const devNodeInUse = () =>
  env.SYNC_MODE !== "off" && resolvedNetwork()?.isDevNode === true && presence().inUse();

// The Safe store's watcher runs while the engine does and someone uses the app (safe/store.ts
// decides how often, within the quota): the members of the signature sets on screen that can
// still be signed whose signature is not valid yet, and the Safes the lists on screen collect
// from. Nothing for a set that can no longer be signed, or a member already valid.
const safeWatch: SafeWatchDriver = {
  active: () => (engineActive() && presence().inUse()) || devNodeInUse(),
  watched: () => {
    const watched: WatchedSafe[] = watchedSetMembers().map((safe) => ({ safe, kind: "set" }));
    for (const safe of listSafes(presence().onScreen())) watched.push({ safe, kind: "list" });
    return watched;
  },
};

// The signature sets on screen are verified again at the served head when a member Safe's
// listing changes, while the engine runs (on a dev node, their pages are told to reload).
const signatureWatch: SignatureWatchDriver = {
  active: engineActive,
  viewing: () => presence().inUse(),
  head: servedHead,
  readsAtLatest: devNodeInUse,
};

// ZKsync Era, while an Era page is on screen (sync/era.ts).
const eraWatch = {
  active: () => engineActive() && presence().inUse(),
  keys: () => presence().onScreen(),
};

let warnedActiveMs = false;

function startDrivers() {
  if (!warnedActiveMs && process.env.SYNC_SAFE_ACTIVE_MS !== undefined) {
    warnedActiveMs = true;
    log.warn(
      "SYNC_SAFE_ACTIVE_MS is no longer used and is ignored: the Safes of what is on screen are checked (SYNC_SAFE_WATCH_MS, SYNC_SAFE_LIST_WATCH_MS)"
    );
  }
  startSafeWatch(safeWatch);
  startSignatureWatch(signatureWatch);
  startEraWatch(eraWatch);
  // The lists on screen may have changed: the Safes they collect from, read from memory.
  if (groupSafes === null && engineActive()) void refreshListSafes().then(nudgeSafeWatch);
}

/**
 * The viewer just signed for this member Safe (a tab's "signed" beat): its listing is read now and
 * a few times over the next two minutes, until the signature shows up (safe/store.ts safeBurst).
 * Only for a member of a signature set on screen. Never throws.
 */
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

/**
 * Starts following the head if it should run and does not (someone uses the app, or
 * SYNC_MODE=always), with its Safe sweep and signature watch. Never throws, never waits.
 */
export function wakeSync() {
  try {
    engine().resume();
    startDrivers();
  } catch (error) {
    log.warn({ error: errorKind(error) }, "sync wake failed");
  }
}

/**
 * For every request that reaches the app (server/index.ts): a page load (see isPageLoad: not
 * /api/*, not a prefetch, not cross-site) counts as use for SYNC_KEEPWARM_MS and wakes the
 * engine; anything else changes nothing. The request itself never waits on it. Never throws.
 */
export function noteRequest(info: RequestInfo) {
  try {
    if (!isPageLoad(info)) return;
    presence().load();
    wakeSync();
  } catch (error) {
    log.warn({ error: errorKind(error) }, "sync request note failed");
  }
}

/**
 * Starts the engine after the server starts listening, and after a settings change (the old
 * engine's reads are dropped): in "always" mode it starts following the head; in "window" mode
 * only if someone uses the app already (the start itself is not use: the boot warm-up reads once,
 * and nothing follows until a page is opened). Never throws.
 */
export function startSync() {
  wakeSync();
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
    // No engine yet: nobody has used the app since the settings were applied.
    cost: {
      ...upstreamCost(),
      mode: presence().inUse() ? "viewing" : "idle",
      pacer: pacer().status(),
    },
    clock: new HeadClock(env.SYNC_HEAD_POLL).status(),
  };
}

// The head whose content pass (the "content" step) last finished.
let contentPassedAt: string | null = null;
// How long after a head is served a beat may still name the one before it, while the content
// pass at the new head runs (from memory; a receipt's read at most).
const CONTENT_PASS_GRACE_MS = 2_000;

/**
 * For a tab's beat, from memory: the newest head the engine served, and whether it has just
 * started and is still reading the blocks it missed. A head is named once the content pass at it
 * is done (what is on screen noted there, sync/content-engine.ts), or 2 s after it was served:
 * until then the head before it, so no item of a tab reads as not re-read at a head only because
 * its pass had not finished. Never asks the node.
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
