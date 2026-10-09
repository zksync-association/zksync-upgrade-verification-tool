import { env } from "@config/env.server";
import type { Address, Hex } from "viem";
import { linkStore } from "../cache";
import { network } from "../rpc";
import {
  type NewestMessage,
  SafeApiError,
  type SafeListing,
  type SafeMessage,
  type SafeMessages,
  type SafeTicket,
  backgroundSafeReadsAllowed,
  fetchListing,
  fetchNewest,
  getSafeMessage,
  quota,
  safeClientGeneration,
  safeCooldownUntil,
} from "../safe-api";

// Snapshots of member Safes' message listings. They are candidate input only, as before: a
// signature counts once the governance contract accepts it in an eth_call, whatever Safe says.
//
// A listing is served while it is at most 60 s old, counted from when Safe's answer arrived. An
// older one is read again for the request that needs it, ahead of any background read (and a
// background read of that Safe already under way is promoted and shared). Callers waiting on the
// same Safe share one read.
//
// While the sync engine runs (the app is in use), a background sweep keeps the listings of the
// signer groups pages asked for in the last SYNC_SAFE_ACTIVE_MS from turning 60 s old: at 50-57 s
// (later when there are more Safes, so that the checks fit the budget) it asks Safe for the Safe's
// most recently modified message (one small request) and re-reads the listing only when that
// changed. Sweeps run only with SAFE_API_KEY or a self-hosted service, spend at most
// SYNC_SAFE_HOURLY_BUDGET requests an hour, pause while the service's quota is below 10 %, and stop
// during a rate-limit cooldown. A Safe whose reads keep failing is retried less and less often.
// Requests then read on demand as without the sweep; a member whose listing cannot be read shows
// as unavailable, never as missing.

/** A listing is served for this long after Safe's answer arrived. */
export const SAFE_LISTING_MAX_AGE_MS = 60_000;
// The sweep re-checks a listing at an age between these: 50 s, or later when the Safes it keeps
// fresh would need more than SWEEP_BUDGET_SHARE of the hourly budget at 50 s, but never so late
// that the pacer's queue and Safe's answer could take it past 60 s.
const SWEEP_MIN_AGE_MS = 50_000;
const SWEEP_MAX_AGE_MS = 57_000;
// The share of the hourly budget planned for change checks; the rest covers re-reading listings
// that changed and retrying failed reads.
const SWEEP_BUDGET_SHARE = 0.95;
const SWEEP_RECHECK_MS = 5_000;
const SWEEP_MIN_DELAY_MS = 250;
// After a Safe's reads failed n times in a row, the sweep waits 15 s x 2^(n-1), at most 5 min,
// before reading it again (safe-api remembers a failed path for 15 s); a success resets it. Pages
// are not held back: a request that needs the Safe still reads it.
const SWEEP_RETRY_MS = 15_000;
const SWEEP_RETRY_MAX_MS = 300_000;
const HOUR_MS = 3_600_000;
// Sweeps pause while the service reports less than this share of its quota left.
const QUOTA_FLOOR = 0.1;
// The keys this store answers for in cache.ts's invalidate() / clearCache().
const KEY_PREFIX = "safe:list:";

export type SafeSnapshot = SafeMessages & {
  /** When Safe's answer arrived (the first page's, or the change check's that found none). */
  fetchedAt: number;
  /** Changes whenever the listing's content changes (never reused); kept when it does not. */
  version: number;
};

type Held = {
  snapshot: SafeSnapshot;
  fingerprint: string;
  /** The newest message by modification that the snapshot reflects; null when not known. */
  newest: NewestMessage | null;
};

/** One read in flight; its ticket is its identity (and its priority, which a request raises). */
type Read = { ticket: SafeTicket; promise: Promise<SafeSnapshot> };

/** A Safe whose last listing read failed. */
type Failure = {
  /** Failures in a row that were the Safe's own (a rate-limit cooldown is the service's). */
  inRow: number;
  /** The sweep reads the Safe again from this time on. */
  retryAt: number;
  /** The last failure's text (Safe's error, never a URL), and when it happened. */
  error: string;
  at: number;
};

const held = new Map<string, Held>();
const reads = new Map<string, Read>();
const demandedAt = new Map<string, number>();
const failures = new Map<string, Failure>();
let generation = safeClientGeneration();
let versions = 0;
// When each background request was sent, for the last hour.
const spent: number[] = [];

/**
 * A background read not sent: the budget, the quota floor or a cooldown stopped it, or it needed a
 * lookup by hash, which only requests make. Not a failure of the Safe.
 */
class SweepPaused extends Error {
  override name = "SweepPaused";
}

/**
 * Drops listings (all of them for null): their next read goes to Safe, and reads in flight are
 * not stored.
 */
function drop(prefix: string | null) {
  const covered = (key: string) => prefix === null || `${KEY_PREFIX}${key}`.startsWith(prefix);
  for (const map of [held, reads, failures])
    for (const key of [...map.keys()]) if (covered(key)) map.delete(key);
}

// refreshSafeData() (invalidate "safe:"), a settings change and dev-node refreshes (clearCache)
// empty this store like the rest of the cache.
linkStore(KEY_PREFIX, drop);

/** Listings from before a settings change are never served. */
function sync() {
  const current = safeClientGeneration();
  if (current === generation) return;
  generation = current;
  drop(null);
}

function servable(key: string): SafeSnapshot | null {
  const entry = held.get(key);
  return entry && Date.now() - entry.snapshot.fetchedAt <= SAFE_LISTING_MAX_AGE_MS
    ? entry.snapshot
    : null;
}

export type SafeReadOptions = {
  /**
   * For reads nobody waits on (the boot warm-up, precomputing): queued behind every request's
   * reads, within the hourly background budget (they fail while sweeps are paused, and on the
   * public service without a key), and not a page's interest in the Safe: the sweep keeps fresh
   * only the groups that pages ask for.
   */
  background?: boolean;
};

/** Newest messages of a Safe, at most 60 s old; read at high priority when older. */
export function listSafeMessages(
  safe: Address,
  { background = false }: SafeReadOptions = {}
): Promise<SafeSnapshot> {
  sync();
  const key = safe.toLowerCase();
  if (!background) demandedAt.set(key, Date.now());
  const snapshot = servable(key);
  return snapshot ? Promise.resolve(snapshot) : readSafe(safe, background ? "low" : "high");
}

/**
 * The message with exactly this hash, preferring the listing to save quota. A background lookup
 * that the listing cannot answer fails instead of asking Safe by hash (outside the budget).
 */
export async function findSafeMessage(
  safe: Address,
  messageHash: Hex,
  options: SafeReadOptions = {}
): Promise<SafeMessage | null> {
  const listing = await listSafeMessages(safe, options);
  const hit = listing.messages.find(
    (m) => m.messageHash.toLowerCase() === messageHash.toLowerCase()
  );
  if (hit) return hit;
  if (listing.complete) return null;
  if (options.background) throw new SweepPaused("lookup by hash");
  return getSafeMessage(messageHash);
}

/** The boot / settings warm-up's read: a background listSafeMessages. */
export function warmSafeListing(safe: Address): Promise<SafeSnapshot> {
  return listSafeMessages(safe, { background: true });
}

/** The version of the listing held for this Safe (served or not), or null. */
export function safeListingVersion(safe: Address): number | null {
  sync();
  return held.get(safe.toLowerCase())?.snapshot.version ?? null;
}

function readSafe(safe: Address, priority: SafeTicket["priority"]): Promise<SafeSnapshot> {
  const key = safe.toLowerCase();
  const running = reads.get(key);
  if (running) {
    if (priority === "low") return running.promise;
    // A request waits on it now: its remaining requests go ahead of background ones.
    running.ticket.priority = "high";
    return running.promise.catch((error: unknown) => {
      // It stopped for a background reason of its own (budget, quota floor, no key for the public
      // service): read for the request.
      if (error instanceof SweepPaused) return readSafe(safe, "high");
      throw error;
    });
  }
  const ticket: SafeTicket = { priority };
  const launched = safeClientGeneration();
  const read: Read = { ticket, promise: runRead(safe, key, ticket) };
  reads.set(key, read);
  const current = () => reads.get(key) === read && launched === safeClientGeneration();
  const settle = () => {
    if (reads.get(key) === read) reads.delete(key);
  };
  // Registered first, so it runs before any joined caller's handlers.
  read.promise.then(settle, (error: unknown) => {
    // A paused background read did not reach Safe; a read from before a refresh or a settings
    // change says nothing about the Safe now.
    if (!(error instanceof SweepPaused) && current()) noteFailure(key, error);
    settle();
  });
  return read.promise;
}

function noteFailure(key: string, error: unknown) {
  const now = Date.now();
  const previous = failures.get(key);
  // A rate-limit cooldown is the service's: the sweep waits for its end, then reads as before.
  const own = safeCooldownUntil() === null;
  const inRow = (previous?.inRow ?? 0) + (own ? 1 : 0);
  failures.set(key, {
    inRow,
    retryAt: own
      ? now + Math.min(SWEEP_RETRY_MAX_MS, SWEEP_RETRY_MS * 2 ** (inRow - 1))
      : previous?.retryAt ?? 0,
    error: describe(error),
    at: now,
  });
}

async function runRead(safe: Address, key: string, ticket: SafeTicket): Promise<SafeSnapshot> {
  const startGeneration = safeClientGeneration();
  const previous = held.get(key);
  // Background requests (only while nobody waits on them) wait while sweeps are paused, without
  // taking a start slot, and count against the budget as they are sent.
  const options = {
    ticket,
    beforeQueue: () => {
      if (ticket.priority === "low") checkBackgroundRequest();
    },
    beforeRequest: () => {
      if (ticket.priority === "low") spendBackgroundRequest();
    },
  };
  if (ticket.priority === "low") {
    // Whoever asks, never in the background on the public service without a key: its monthly
    // per-IP quota is for the pages that are opened.
    const { safeTxServiceUrl } = await network();
    if (
      ticket.priority === "low" &&
      safeTxServiceUrl &&
      !backgroundSafeReadsAllowed(safeTxServiceUrl)
    )
      throw new SweepPaused("keyless-public-service");
  }
  let checked: NewestMessage | null = null;
  // A background read asks first whether anything changed since the listing it holds.
  if (ticket.priority === "low" && previous) {
    const newest = await fetchNewest(safe, options);
    if (previous.newest && sameNewest(newest, previous.newest)) {
      const snapshot = { ...previous.snapshot, fetchedAt: newest.arrivedAt };
      return commit(key, ticket, previous, { ...previous, snapshot }, startGeneration);
    }
    checked = newest;
  }
  const listing = await fetchListing(safe, options);
  const fingerprint = JSON.stringify([listing.complete, listing.messages]);
  const version =
    previous && previous.fingerprint === fingerprint ? previous.snapshot.version : ++versions;
  return commit(
    key,
    ticket,
    previous,
    {
      snapshot: {
        messages: listing.messages,
        complete: listing.complete,
        fetchedAt: listing.arrivedAt,
        version,
      },
      fingerprint,
      // From the listing itself when it shows it; otherwise the change check made before it
      // (never newer than the listing, so a change after it is still seen by the next check).
      newest: newestOf(listing) ?? checked,
    },
    startGeneration
  );
}

/**
 * Stores a read's result unless the listing was dropped meanwhile (refresh, settings change); the
 * callers waiting on it get it either way, except across a settings change.
 */
function commit(
  key: string,
  ticket: SafeTicket,
  previous: Held | undefined,
  next: Held,
  startGeneration: number
): SafeSnapshot {
  if (startGeneration !== safeClientGeneration())
    throw new SafeApiError("Data source settings changed. Refresh to check signatures again.");
  if (reads.get(key)?.ticket === ticket && held.get(key) === previous) {
    held.set(key, next);
    failures.delete(key);
  }
  return next.snapshot;
}

function sameNewest(a: NewestMessage, b: NewestMessage): boolean {
  return (
    a.count === b.count &&
    a.modified === b.modified &&
    (a.messageHash?.toLowerCase() ?? null) === (b.messageHash?.toLowerCase() ?? null)
  );
}

/** Microseconds since the epoch, from Safe's ISO timestamps (which carry microseconds). */
function instant(value: string): number | null {
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return null;
  const extra = /\.\d{3}(\d{1,3})/.exec(value)?.[1] ?? "";
  return ms * 1_000 + Number(extra.padEnd(3, "0"));
}

/**
 * The listing's newest message by modification, as Safe's change check would name it: only for a
 * complete listing whose newest is unambiguous (no tie), otherwise null (not known).
 */
function newestOf(listing: SafeListing): NewestMessage | null {
  if (!listing.complete) return null;
  let best: { message: SafeMessage; at: number } | null = null;
  let tied = false;
  for (const message of listing.messages) {
    const at = instant(message.modified);
    if (at === null) return null;
    if (!best || at > best.at) {
      best = { message, at };
      tied = false;
    } else if (at === best.at) tied = true;
  }
  if (tied) return null;
  return {
    count: listing.count,
    messageHash: best?.message.messageHash ?? null,
    modified: best?.message.modified ?? null,
  };
}

// ---- background budget ----

function budgetUsed(now: number): number {
  while (spent.length > 0 && (spent[0] as number) <= now - HOUR_MS) spent.shift();
  return spent.length;
}

/** Why background reads must wait right now, or null. */
function pauseReason(now: number): string | null {
  if (safeCooldownUntil() !== null) return "cooldown";
  if (
    quota.limit !== null &&
    quota.remaining !== null &&
    quota.remaining < quota.limit * QUOTA_FLOOR
  )
    return "quota";
  if (budgetUsed(now) >= env.SYNC_SAFE_HOURLY_BUDGET) return "budget";
  return null;
}

function checkBackgroundRequest() {
  const reason = pauseReason(Date.now());
  if (reason) throw new SweepPaused(reason);
}

function spendBackgroundRequest() {
  checkBackgroundRequest();
  spent.push(Date.now());
}

/** Background reads under way: each sends at least one more request (a changed listing, more). */
function backgroundReads(): number {
  let count = 0;
  for (const read of reads.values()) if (read.ticket.priority === "low") count++;
  return count;
}

/**
 * The listing age at which the sweep re-checks each of `count` Safes: 50 s while that fits in
 * SWEEP_BUDGET_SHARE of the hourly budget, later (up to 57 s) when it does not.
 */
function sweepAgeMs(count: number): number {
  const spacing = (count * HOUR_MS) / (env.SYNC_SAFE_HOURLY_BUDGET * SWEEP_BUDGET_SHARE);
  if (!Number.isFinite(spacing)) return SWEEP_MAX_AGE_MS;
  return Math.min(SWEEP_MAX_AGE_MS, Math.max(SWEEP_MIN_AGE_MS, Math.ceil(spacing)));
}

// ---- the sweep ----

export type SignerGroupName = "securityCouncil" | "guardians" | "zkFoundation";
export type SafeGroups = Record<SignerGroupName, readonly Address[]>;

export type SafeSweepDriver = {
  /** Whether the sync engine is following the chain (the app is in use). */
  active: () => boolean;
  /** The member Safes of each signer group (from governance). */
  groups: () => Promise<SafeGroups>;
};

const GROUPS: readonly SignerGroupName[] = ["securityCouncil", "guardians", "zkFoundation"];

let driver: SafeSweepDriver | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let waking = false;
const sweep = {
  /** The loop is running (the engine was active at its last wake). */
  running: false,
  /** Why sweeps cannot run at all here (dev node, keyless public service), or null. */
  blocked: null as string | null,
  groups: [] as SignerGroupName[],
  safes: [] as string[],
  /** Why the last wake could not look at the groups (governance, the network), or null. */
  error: null as string | null,
};

/** Starts the sweep (idempotent); it stops by itself once `driver.active()` says the app is idle. */
export function startSafeSweep(next: SafeSweepDriver) {
  driver = next;
  if (timer === null && !waking) schedule(0);
}

export function stopSafeSweep() {
  driver = null;
  if (timer) clearTimeout(timer);
  timer = null;
  idle();
}

function idle() {
  sweep.running = false;
  sweep.groups = [];
  sweep.safes = [];
}

function schedule(ms: number) {
  const next = setTimeout(() => void wake(), ms);
  (next as { unref?: () => void }).unref?.();
  timer = next;
}

async function wake() {
  timer = null;
  const current = driver;
  if (!current) return;
  // Idle: the timer stops; the next request starts the sweep again.
  if (!current.active()) {
    idle();
    return;
  }
  waking = true;
  let delay = SWEEP_RECHECK_MS;
  try {
    delay = await sweepOnce(current);
  } catch (error) {
    // Governance (the groups) or the network could not be read: try again shortly.
    sweep.error = describe(error);
  } finally {
    waking = false;
  }
  if (driver !== null && timer === null) schedule(delay);
}

/** Starts the background reads that are due; returns when to look again. */
async function sweepOnce(current: SafeSweepDriver): Promise<number> {
  sync();
  sweep.running = true;
  const net = await network();
  sweep.blocked = net.isDevNode
    ? "dev-node"
    : !net.safeTxServiceUrl
      ? "no-service"
      : !backgroundSafeReadsAllowed(net.safeTxServiceUrl)
        ? "keyless-public-service"
        : null;
  // Blocked, or nothing asked for lately: no need to know the groups (governance) at all.
  if (
    sweep.blocked !== null ||
    ![...demandedAt.values()].some((at) => Date.now() - at <= env.SYNC_SAFE_ACTIVE_MS)
  ) {
    sweep.groups = [];
    sweep.safes = [];
    sweep.error = null;
    return SWEEP_RECHECK_MS;
  }
  const groups = await current.groups();
  sweep.error = null;
  const now = Date.now();
  const { names, safes } = demanded(groups, now);
  sweep.groups = names;
  sweep.safes = safes.map((safe) => safe.toLowerCase());
  if (safes.length === 0 || pauseReason(now) !== null) return SWEEP_RECHECK_MS;

  const age = sweepAgeMs(safes.length);
  let next = SWEEP_RECHECK_MS;
  const due: { safe: Address; at: number }[] = [];
  for (const safe of safes) {
    const key = safe.toLowerCase();
    if (reads.has(key)) continue;
    const entry = held.get(key);
    // A Safe without a listing is due now; one that failed waits for its retry time.
    const at = Math.max(
      entry ? entry.snapshot.fetchedAt + age : now,
      failures.get(key)?.retryAt ?? 0
    );
    if (at > now) next = Math.min(next, at - now);
    else due.push({ safe, at });
  }
  // The most overdue first, and only as many as the budget has room for (a read under way sends
  // at least one more request). Failures are noted by readSafe.
  due.sort((a, b) => a.at - b.at);
  const room = env.SYNC_SAFE_HOURLY_BUDGET - budgetUsed(now) - backgroundReads();
  for (const { safe } of due.slice(0, Math.max(0, room))) void readSafe(safe, "low");
  return Math.max(SWEEP_MIN_DELAY_MS, next);
}

/** The groups with a member Safe a page asked for within SYNC_SAFE_ACTIVE_MS, and their Safes. */
function demanded(groups: SafeGroups, now: number) {
  const recent = (safe: Address) => {
    const at = demandedAt.get(safe.toLowerCase());
    return at !== undefined && now - at <= env.SYNC_SAFE_ACTIVE_MS;
  };
  const names: SignerGroupName[] = [];
  const safes = new Map<string, Address>();
  for (const name of GROUPS) {
    const members = groups[name];
    if (!members.some(recent)) continue;
    names.push(name);
    for (const safe of members)
      if (!safes.has(safe.toLowerCase())) safes.set(safe.toLowerCase(), safe);
  }
  return { names, safes: [...safes.values()] };
}

/** A Safe API error's text (no URL or key in it), else only the error's class name. */
function describe(error: unknown): string {
  if (error instanceof SafeApiError) return error.message;
  const name = error instanceof Error ? error.name : typeof error;
  return /^[A-Za-z]\w{0,63}$/.test(name) ? name : "Error";
}

export type SafeStoreStatus = {
  /** Background reads are keeping the listings below fresh right now. */
  sweeping: boolean;
  /** Signer groups a page asked for within SYNC_SAFE_ACTIVE_MS (while the engine runs). */
  groups: SignerGroupName[];
  /** The oldest listing held for those groups' Safes (ISO time), or null. */
  oldestFetchedAt: string | null;
  /** Background requests sent in the last hour, and the hourly budget. */
  budgetUsedThisHour: number;
  budgetPerHour: number;
  /**
   * Why sweeps are not running: idle (the app is not in use, or the engine is off), dev-node,
   * no-service, keyless-public-service, cooldown, quota, budget; null when they are not paused.
   */
  paused: string | null;
  /**
   * Why the sweep could not look at the groups, else the most recent failure among those groups'
   * Safes whose listing has not been read since (Safe's error text, never a URL), or null.
   */
  lastError: string | null;
  /** How many of those groups' Safes the last listing read failed for (retried with backoff). */
  failingSafes: number;
};

/** What the store's background sweep is doing, for /api/status. */
export function safeStoreStatus(): SafeStoreStatus {
  sync();
  const now = Date.now();
  const running = driver !== null && sweep.running && driver.active();
  const paused = !running ? "idle" : sweep.blocked ?? pauseReason(now);
  let oldest: number | null = null;
  let latest: Failure | null = null;
  let failing = 0;
  for (const key of sweep.safes) {
    const at = held.get(key)?.snapshot.fetchedAt;
    if (at !== undefined && (oldest === null || at < oldest)) oldest = at;
    const failure = failures.get(key);
    if (!failure) continue;
    failing++;
    if (latest === null || failure.at > latest.at) latest = failure;
  }
  return {
    sweeping: running && paused === null && sweep.safes.length > 0,
    groups: running ? [...sweep.groups] : [],
    oldestFetchedAt: running && oldest !== null ? new Date(oldest).toISOString() : null,
    budgetUsedThisHour: budgetUsed(now),
    budgetPerHour: env.SYNC_SAFE_HOURLY_BUDGET,
    paused,
    lastError: sweep.error ?? latest?.error ?? null,
    failingSafes: failing,
  };
}
