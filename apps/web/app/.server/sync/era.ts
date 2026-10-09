import { isIndexedL2Governor } from "../chain/l2-index";
import { type L2ProposalView, knownGovernors } from "../flows/l2";
import { type L2Head, l2, lastL2Head, network, refreshL2ChainHead, rpcGeneration } from "../rpc";
import { noteEraContent } from "./content-engine";
import { isL2Key } from "./presence";

// ZKsync Era while a page showing it is on screen (a veto's L2 proposal `l2:…`, the vetoable list
// `list:vetoes`, the upgrades that can start `list:startable`), and only then: a timer reads Era's
// head every minute ('finalized' every 32 reads), and at it the governor index's tail and what
// those pages show (the proposals' states, the startable upgrades with their proofs), so pages
// answer from memory (labelled "Era block #E · read Xs ago") and learn of a change by their next
// beat. A proposal on screen that is Pending or Active also gets a timer at its voteStart or
// voteEnd, scheduled from the last Era head's timestamp (never the local clock's) and confirmed
// when it fires by an Era head past the boundary (else armed again 2 s later), so a page sees the
// state change within seconds. Nothing while no such page is on screen or nobody uses the app;
// JSON reads Era on demand (its head at most 4 s old), as before.

/** The Era timer's period. */
export const ERA_EVERY_MS = 60_000;
// 'finalized' is read again every this many reads (finality only moves forward meanwhile).
const FINALIZED_EVERY = 32;
// A boundary timer that fires before Era's head is past the boundary is armed again this long
// later, at most this many times.
const BOUNDARY_RETRY_MS = 2_000;
const BOUNDARY_RETRIES = 30;
// Boundaries further out than this are left to the minute timer.
const BOUNDARY_HORIZON_MS = 30 * 60_000;

export type EraDriver = {
  /** The sync engine follows the chain and someone uses the app. */
  active: () => boolean;
  /** The keys on screen now. */
  keys: () => ReadonlySet<string>;
};

type Boundary = {
  /** The Era timestamp (s) the state changes at. */
  at: bigint;
  /**
   * The armed timer; null once it fired and the boundary is not confirmed yet (a read under way,
   * or the retries used up: then the minute timer reads on, and the boundary is not armed again).
   */
  timer: ReturnType<typeof setTimeout> | null;
  /** Retries after the first firing (at most BOUNDARY_RETRIES). */
  tries: number;
};

let driver: EraDriver | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let running: Promise<void> | null = null;
let reads = 0;
let generation = -1;
let lastRunAt: number | null = null;
const boundaries = new Map<string, Boundary>();

/** The Era keys on screen now (none while nobody uses the app). */
function eraKeys(): string[] {
  const current = driver;
  if (!current?.active()) return [];
  return [...current.keys()].filter(isL2Key);
}

/**
 * Starts the Era timer (idempotent): a run now when an Era page is on screen and the last run is
 * older than a minute, then every minute while one is. It stops by itself.
 */
export function startEraWatch(next: EraDriver) {
  driver = next;
  if (generation !== rpcGeneration()) {
    generation = rpcGeneration();
    reads = 0;
    lastRunAt = null;
    clearBoundaries();
  }
  if (timer !== null || running !== null) return;
  if (eraKeys().length === 0) return;
  const since = lastRunAt === null ? Number.POSITIVE_INFINITY : Date.now() - lastRunAt;
  // A clock stepped back counts as a minute gone.
  schedule(since >= ERA_EVERY_MS || since < 0 ? 0 : ERA_EVERY_MS - since);
}

/** Stops for good (the engine stopped): no timer is left; the next start reads Era at once. */
export function stopEraWatch() {
  driver = null;
  if (timer) clearTimeout(timer);
  timer = null;
  lastRunAt = null;
  reads = 0;
  clearBoundaries();
}

function schedule(ms: number) {
  if (timer) clearTimeout(timer);
  const next = setTimeout(() => void tick(), Math.max(0, ms));
  (next as { unref?: () => void }).unref?.();
  timer = next;
}

async function tick() {
  timer = null;
  if (eraKeys().length === 0) {
    clearBoundaries();
    return;
  }
  await run();
  if (driver && eraKeys().length > 0 && timer === null) schedule(ERA_EVERY_MS);
}

/** One read of Era for what is on screen (shared by the minute timer and the boundary timers). */
function run(): Promise<void> {
  running ??= readEra().finally(() => {
    running = null;
  });
  return running;
}

async function readEra(): Promise<void> {
  const started = generation;
  const current = () => started === rpcGeneration() && eraKeys().length > 0;
  try {
    const pass = await eraPass(eraKeys(), current);
    lastRunAt = Date.now();
    if (pass && current()) armBoundaries(pass.at, pass.proposals);
  } catch {
    // Era could not be read: pages read it on demand; the next minute tries again.
  }
}

/**
 * One read of Era for these keys: Era's head ('latest'; 'finalized' every 32 reads, and while none
 * is known), then at it the governor index's tail and what the pages with these keys show (noted
 * for their revisions). null when no governor is indexed (or no L2 RPC): pages then read Era on
 * demand. Rejects when Era's head cannot be read.
 */
export async function eraPass(
  keys: readonly string[],
  current: () => boolean = () => true
): Promise<{ at: L2Head; proposals: L2ProposalView[] } | null> {
  if (!(await l2())) return null;
  const net = await network();
  const governors = await knownGovernors();
  if (!governors.some((g) => isIndexedL2Governor(net, g.address))) return null;
  const at = await refreshL2ChainHead({ withFinalized: reads % FINALIZED_EVERY === 0 });
  reads++;
  // Era without the 'finalized' tag: nothing is indexed at its heads (flows scan on demand).
  if (!at || at.safe < 0n || !current()) return null;
  const { proposals } = await noteEraContent(keys, current);
  return { at, proposals };
}

/**
 * A timer at each on-screen proposal's next boundary: voteStart while Pending, voteEnd while
 * Active. Scheduled from `at` (an Era head and when Era answered): the boundary is that many
 * seconds after the head's timestamp, so the local clock's error does not count, only the time
 * since the answer.
 */
function armBoundaries(at: L2Head, proposals: readonly L2ProposalView[]) {
  const wanted = new Map<string, bigint>();
  for (const p of proposals) {
    const boundary =
      p.state === "Pending" ? BigInt(p.voteStart) : p.state === "Active" ? BigInt(p.voteEnd) : null;
    if (boundary === null || boundary < at.head.timestamp) continue;
    wanted.set(`${p.governor.toLowerCase()}:${p.proposalId}`, boundary);
  }
  for (const [key, boundary] of boundaries)
    if (wanted.get(key) !== boundary.at) {
      if (boundary.timer) clearTimeout(boundary.timer);
      boundaries.delete(key);
    }
  for (const [key, boundaryAt] of wanted) {
    // Armed already, or fired and not confirmed yet (its own retries, or the minute timer's).
    if (boundaries.has(key)) continue;
    // One second past the boundary, counted from the head's timestamp, less the time since Era
    // answered with that head.
    const delay = Number(boundaryAt - at.head.timestamp + 1n) * 1000 - (Date.now() - at.answeredAt);
    if (delay > BOUNDARY_HORIZON_MS) continue;
    arm(key, { at: boundaryAt, timer: null, tries: 0 }, Math.max(0, delay));
  }
}

/** Arms the boundary's timer (one per key: one armed before is cleared). */
function arm(key: string, boundary: Boundary, delay: number) {
  if (boundary.timer) clearTimeout(boundary.timer);
  const fire = setTimeout(() => void onBoundary(key, boundary), delay);
  (fire as { unref?: () => void }).unref?.();
  boundary.timer = fire;
  boundaries.set(key, boundary);
}

async function onBoundary(key: string, boundary: Boundary) {
  if (boundaries.get(key) !== boundary) return;
  // Fired: kept (without a timer) while it is read, so the read's own re-arming leaves it alone.
  boundary.timer = null;
  if (eraKeys().length === 0) return;
  await run();
  // Dropped or replaced meanwhile (the proposal's state moved on, or the page left).
  if (boundaries.get(key) !== boundary) return;
  // Confirmed only by an Era head past the boundary: else again shortly (Era's blocks can lag),
  // at most BOUNDARY_RETRIES times; then the minute timer reads on.
  const head = lastL2Head();
  if (head && head.head.timestamp > boundary.at) {
    boundaries.delete(key);
    return;
  }
  if (boundary.tries >= BOUNDARY_RETRIES || eraKeys().length === 0) return;
  boundary.tries++;
  arm(key, boundary, BOUNDARY_RETRY_MS);
}

function clearBoundaries() {
  for (const boundary of boundaries.values()) if (boundary.timer) clearTimeout(boundary.timer);
  boundaries.clear();
}

export type EraWatchStatus = {
  /** Era pages on screen (keys). */
  onScreen: number;
  /** The newest Era head read (number) and when Era answered (ISO), or null. */
  eraBlock: string | null;
  readAt: string | null;
  /** Boundary timers armed (at most one per proposal on screen). */
  boundaries: number;
};

/** What the Era timer does, for /api/status (sync.l2). */
export function eraWatchStatus(): EraWatchStatus {
  const head = lastL2Head();
  return {
    onScreen: eraKeys().length,
    eraBlock: head ? head.head.number.toString() : null,
    readAt: head ? new Date(head.answeredAt).toISOString() : null,
    boundaries: [...boundaries.values()].filter((boundary) => boundary.timer !== null).length,
  };
}
