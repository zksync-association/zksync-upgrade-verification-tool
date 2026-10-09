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
// same Safe share one read. A page (never JSON) may show a held listing of any age first,
// labelled with its age, while that read runs (heldSafeListing); the fresh answer then replaces it.
//
// While the sync engine runs, a background sweep checks member Safes' listings: it asks Safe for
// the Safe's most recently modified message (one small request) and re-reads the listing only
// when that changed. While the app is in use, the listings of the signer groups pages asked for in
// the last SYNC_SAFE_ACTIVE_MS are kept from turning 60 s old (checked at 50-57 s, later when there
// are more Safes, so that the checks fit the budget). With SYNC_MODE=always every governance member
// Safe is also checked, in use or idle, at an interval paced by the quota Safe reports as left
// for its period (see idleSweepIntervalMs): about every 10-20 minutes with a key. Sweeps run only
// with SAFE_API_KEY or a self-hosted service, spend at most SYNC_SAFE_HOURLY_BUDGET requests an
// hour, pause while the service's quota is below 10 %, and stop during a rate-limit cooldown. A
// Safe whose reads keep failing is retried less and less often. Requests read on demand as without
// the sweep; a member whose listing cannot be read shows as unavailable, never as missing.

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
// The quota-paced check of every governance Safe: never more often than this, keeping this share
// of the period's quota in reserve, and at this interval when Safe reports no quota.
const IDLE_MIN_INTERVAL_MS = 10 * 60_000;
const IDLE_DEFAULT_INTERVAL_MS = 15 * 60_000;
const IDLE_RESERVE = 0.2;
// The keys this store answers for in cache.ts's invalidate() / clearCache().
const KEY_PREFIX = "safe:list:";

export type SafeSnapshot = SafeMessages & {
  /** When Safe's answer arrived (the first page's, or the change check's that found none). */
  fetchedAt: number;
  /** Changes whenever the listing's content changes (never reused); kept when it does not. */
  version: number;
  /**
   * Read by the last run and kept on disk (persist/chain-cache.ts), not by this one: whatever its
   * age, only a page's first answer may use it, labelled; it is never served as a listing at
   * most 60 s old, and the first read of the Safe replaces it.
   */
  fromLastRun?: true;
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
  return entry &&
    !entry.snapshot.fromLastRun &&
    Date.now() - entry.snapshot.fetchedAt <= SAFE_LISTING_MAX_AGE_MS
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
  return (await lookupSafeMessage(safe, messageHash, options)).message;
}

export type SafeMessageLookup = {
  message: SafeMessage | null;
  /**
   * The version of the listing that answered (see SafeSnapshot.version); null when it could not
   * and Safe was asked for the message by its hash.
   */
  version: number | null;
  /**
   * When the listing that answered arrived (ms since the epoch, see SafeSnapshot.fetchedAt); null
   * when Safe was asked for the message by its hash (an answer read just now).
   */
  fetchedAt: number | null;
  /** The listing that answered was read by the last run (see SafeSnapshot.fromLastRun). */
  fromLastRun?: true;
};

/** findSafeMessage, with the listing version the answer came from. */
export async function lookupSafeMessage(
  safe: Address,
  messageHash: Hex,
  options: SafeReadOptions = {}
): Promise<SafeMessageLookup> {
  const listing = await listSafeMessages(safe, options);
  const answer = answerFrom(listing, messageHash);
  if (answer) return answer;
  if (options.background) throw new SweepPaused("lookup by hash");
  return { message: await getSafeMessage(messageHash), version: null, fetchedAt: null };
}

/**
 * The same lookup from the listing held now, without asking Safe or marking the Safe as wanted by
 * a page: null when there is no listing at most 60 s old, or it cannot tell (the message may be
 * past its last page). For precomputing.
 */
export function peekSafeMessage(safe: Address, messageHash: Hex): SafeMessageLookup | null {
  sync();
  const listing = servable(safe.toLowerCase());
  return listing ? answerFrom(listing, messageHash) : null;
}

/**
 * The listing held for this Safe whatever its age (older than 60 s included), without asking Safe
 * or marking the Safe as wanted by a page; null when none is held. Only for a page's first answer,
 * labelled with the listing's fetchedAt while a fresh one is read (never for JSON, never for a
 * verdict that is kept): Safe data is candidate input only, so an old copy can only show fewer
 * signatures than there are, never make one count.
 */
export function heldSafeListing(safe: Address): SafeSnapshot | null {
  sync();
  return held.get(safe.toLowerCase())?.snapshot ?? null;
}

/**
 * peekSafeMessage from the listing held whatever its age (see heldSafeListing): null when none is
 * held or it cannot tell.
 */
export function peekHeldSafeMessage(safe: Address, messageHash: Hex): SafeMessageLookup | null {
  const listing = heldSafeListing(safe);
  return listing ? answerFrom(listing, messageHash) : null;
}

function answerFrom(listing: SafeSnapshot, messageHash: Hex): SafeMessageLookup | null {
  const hit = listing.messages.find(
    (m) => m.messageHash.toLowerCase() === messageHash.toLowerCase()
  );
  const { version, fetchedAt } = listing;
  const origin = listing.fromLastRun ? { fromLastRun: true as const } : {};
  if (hit) return { message: hit, version, fetchedAt, ...origin };
  return listing.complete ? { message: null, version, fetchedAt, ...origin } : null;
}

/**
 * The version of the listing that would be served for this Safe now (at most 60 s old), or null
 * when there is none: a result computed from a listing holds while this still names its version.
 */
export function freshListingVersion(safe: Address): number | null {
  sync();
  return servable(safe.toLowerCase())?.version ?? null;
}

/**
 * Marks Safes as wanted by a page, as listSafeMessages does, for a page answered from a result
 * computed earlier from their listings: the sweep keeps their group fresh.
 */
export function markSafeDemand(safes: Iterable<string>) {
  const now = Date.now();
  for (const safe of safes) demandedAt.set(safe.toLowerCase(), now);
}

type ListingListener = (safe: Address) => void;
const listeners = new Set<ListingListener>();

/**
 * Calls `listener` (after the read that stored it) whenever a Safe's listing is stored with a new
 * version: its content changed, or it was read for the first time. Returns the unsubscribe.
 */
export function onSafeListingChange(listener: ListingListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notifyChange(safe: Address) {
  if (listeners.size === 0) return;
  queueMicrotask(() => {
    for (const listener of listeners) {
      try {
        listener(safe);
      } catch {
        // A listener's failure is its own.
      }
    }
  });
}

/** The boot / settings warm-up's read: a background listSafeMessages. */
export function warmSafeListing(safe: Address): Promise<SafeSnapshot> {
  return listSafeMessages(safe, { background: true });
}

/** The version of the listing held for this Safe (served or not, see freshListingVersion), or null. */
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
  // A background read asks first whether anything changed since the listing it holds; never
  // about a listing the last run read (no check is trusted against it: it is read in full).
  if (ticket.priority === "low" && previous && !previous.snapshot.fromLastRun) {
    const newest = await fetchNewest(safe, options);
    if (previous.newest && sameNewest(newest, previous.newest)) {
      const snapshot = { ...previous.snapshot, fetchedAt: newest.arrivedAt };
      return commit(key, ticket, previous, { ...previous, snapshot }, startGeneration);
    }
    checked = newest;
  }
  const listing = await fetchListing(safe, options);
  const fingerprint = JSON.stringify([listing.complete, listing.messages]);
  const unchanged = previous !== undefined && previous.fingerprint === fingerprint;
  const version = previous && unchanged ? previous.snapshot.version : ++versions;
  return commit(
    key,
    ticket,
    previous,
    {
      snapshot: {
        // The objects held for messages that did not change (all of them, when none did): what
        // was derived from them (flows/messages.ts parses and hashes each once) still applies.
        messages: !previous
          ? listing.messages
          : unchanged
            ? previous.snapshot.messages
            : sameObjects(listing.messages, previous.snapshot.messages),
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
    if (previous?.snapshot.version !== next.snapshot.version) notifyChange(key as Address);
  }
  return next.snapshot;
}

/**
 * The messages just read, each one that has not changed since `held` replaced by the object held
 * for it. Equal means the same JSON: exactly the same content.
 */
function sameObjects(read: SafeMessage[], held: SafeMessage[]): SafeMessage[] {
  if (held.length === 0) return read;
  const byContent = new Map(held.map((message) => [JSON.stringify(message), message]));
  return read.map((message) => byContent.get(JSON.stringify(message)) ?? message);
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

// ---- listings kept between runs (persist/chain-cache.ts) ----

/** A listing as kept on disk: what Safe answered, and when. */
export type KeptSafeListing = SafeMessages & { safe: Address; fetchedAt: number };

/**
 * The listings held, for saving, with their versions (a new version means the content changed):
 * those this run read, and those the last run read for Safes this run has not read yet (kept with
 * the time Safe answered then, so they stay labelled with their true age).
 */
export function listingsToKeep(): (KeptSafeListing & { version: number })[] {
  sync();
  const out: (KeptSafeListing & { version: number })[] = [];
  for (const [key, entry] of held) {
    const { snapshot } = entry;
    out.push({
      safe: key as Address,
      messages: snapshot.messages,
      complete: snapshot.complete,
      fetchedAt: snapshot.fetchedAt,
      version: snapshot.version,
    });
  }
  return out;
}

/**
 * Holds listings the last run read (see SafeSnapshot.fromLastRun) for Safes this run has none of
 * yet. Each gets a version of its own; none is ever served as at most 60 s old, and the first
 * read of the Safe (a request's, or a background one, which reads it in full without a change
 * check first) replaces it. Returns how many were held.
 */
export function holdLastRunListings(listings: readonly KeptSafeListing[]): number {
  sync();
  let count = 0;
  for (const listing of listings) {
    const key = listing.safe.toLowerCase();
    if (held.has(key) || reads.has(key)) continue;
    held.set(key, {
      snapshot: {
        messages: listing.messages,
        complete: listing.complete,
        fetchedAt: listing.fetchedAt,
        version: ++versions,
        fromLastRun: true,
      },
      fingerprint: JSON.stringify([listing.complete, listing.messages]),
      newest: null,
    });
    count++;
  }
  return count;
}

/** Drops the last run's listings still held (the chain cache was found wrong). */
export function dropLastRunListings() {
  for (const [key, entry] of [...held]) if (entry.snapshot.fromLastRun) held.delete(key);
}

// ---- background budget ----

function budgetUsed(now: number): number {
  while (spent.length > 0 && (spent[0] as number) <= now - HOUR_MS) spent.shift();
  return spent.length;
}

/**
 * The quota Safe last reported, while it still describes the current period: once the reported
 * period has ended, what was left then says nothing about the new one.
 */
function currentQuota(now: number): { limit: number; remaining: number } | null {
  if (quota.limit === null || quota.remaining === null) return null;
  if (quota.resetAt !== null && now >= quota.resetAt) return null;
  return { limit: quota.limit, remaining: quota.remaining };
}

/** Why background reads must wait right now, or null. */
function pauseReason(now: number): string | null {
  if (safeCooldownUntil() !== null) return "cooldown";
  const left = currentQuota(now);
  if (left && left.remaining < left.limit * QUOTA_FLOOR) return "quota";
  if (budgetUsed(now) >= env.SYNC_SAFE_HOURLY_BUDGET) return "budget";
  return null;
}

export type QuotaReport = {
  limit: number | null;
  remaining: number | null;
  /** When the quota period ends (ms since the epoch), or null. */
  resetAt: number | null;
};

/**
 * How often each of `safes` member Safes is checked when nobody is using the app: spread what is
 * left of the period's quota above a 20 % reserve over the time to its end, one change check per
 * Safe each round, never more often than every 10 minutes:
 * max(10 min, safes x time to reset / max(1, remaining - 20 % of limit)). Without quota headers
 * (or once the reported period has ended without a newer report): every 15 minutes. With nothing
 * left above the reserve, a round costs the whole time to the reset: the Safes wait for it.
 */
export function idleSweepIntervalMs(
  safes: number,
  report: QuotaReport = quota,
  now = Date.now()
): number {
  const { limit, remaining, resetAt } = report;
  if (limit === null || remaining === null || resetAt === null) return IDLE_DEFAULT_INTERVAL_MS;
  const untilReset = resetAt - now;
  if (untilReset <= 0) return IDLE_DEFAULT_INTERVAL_MS;
  const spare = Math.max(1, remaining - IDLE_RESERVE * limit);
  const interval = (Math.max(1, safes) * untilReset) / spare;
  return Number.isFinite(interval)
    ? Math.max(IDLE_MIN_INTERVAL_MS, Math.ceil(interval))
    : IDLE_DEFAULT_INTERVAL_MS;
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
  /** Whether the sync engine is following the chain. */
  active: () => boolean;
  /**
   * Someone is using the app (a request within SYNC_KEEPWARM_MS): the groups pages asked for are
   * kept under 60 s old. Default true.
   */
  viewing?: () => boolean;
  /**
   * Every governance member Safe is also checked at the quota-paced interval, in use or idle
   * (SYNC_MODE=always). Default false.
   */
  baseline?: () => boolean;
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
  /** Groups kept under 60 s old (a page asked for them while the app is in use). */
  groups: [] as SignerGroupName[],
  /** Every Safe swept, either way. */
  safes: [] as string[],
  /** The Safes of those groups. */
  fresh: [] as string[],
  /** The quota-paced check of every governance Safe: how many, and how often; null when off. */
  baseline: null as { safes: number; intervalMs: number } | null,
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
  sweep.fresh = [];
  sweep.baseline = null;
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
  const viewing = current.viewing?.() ?? true;
  const baseline = current.baseline?.() ?? false;
  const asked =
    viewing && [...demandedAt.values()].some((at) => Date.now() - at <= env.SYNC_SAFE_ACTIVE_MS);
  // Blocked, or nothing to keep fresh: no need to know the groups (governance) at all.
  if (sweep.blocked !== null || (!asked && !baseline)) {
    sweep.groups = [];
    sweep.safes = [];
    sweep.fresh = [];
    sweep.baseline = null;
    sweep.error = null;
    return SWEEP_RECHECK_MS;
  }
  const groups = await current.groups();
  sweep.error = null;
  const now = Date.now();
  const { names, safes: fast } = asked ? demanded(groups, now) : { names: [], safes: [] };
  const all = baseline ? everySafe(groups) : [];
  const swept = new Map<string, Address>();
  for (const safe of [...fast, ...all]) swept.set(safe.toLowerCase(), safe);
  const fastKeys = new Set(fast.map((safe) => safe.toLowerCase()));
  const slowAge = all.length > 0 ? idleSweepIntervalMs(all.length, quota, now) : null;
  sweep.groups = names;
  sweep.safes = [...swept.keys()];
  sweep.fresh = [...fastKeys];
  sweep.baseline = slowAge === null ? null : { safes: all.length, intervalMs: slowAge };
  if (swept.size === 0 || pauseReason(now) !== null) return SWEEP_RECHECK_MS;

  const fastAge = sweepAgeMs(fast.length);
  let next = SWEEP_RECHECK_MS;
  const due: { safe: Address; at: number }[] = [];
  for (const [key, safe] of swept) {
    if (reads.has(key)) continue;
    const entry = held.get(key);
    const age = fastKeys.has(key) ? fastAge : (slowAge as number);
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

/** Every member Safe of the signer groups, each once. */
function everySafe(groups: SafeGroups): Address[] {
  const safes = new Map<string, Address>();
  for (const name of GROUPS)
    for (const safe of groups[name])
      if (!safes.has(safe.toLowerCase())) safes.set(safe.toLowerCase(), safe);
  return [...safes.values()];
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
  /**
   * Background reads are running right now: for `groups` (kept under 60 s old) and/or the
   * `baseline` (every member Safe, checked only every `baseline.intervalMs`). Not by itself a sign
   * that listings are under 60 s old: `groups` and `oldestFetchedAt` tell which are.
   */
  sweeping: boolean;
  /**
   * Signer groups a page asked for within SYNC_SAFE_ACTIVE_MS while the app is in use: kept under
   * 60 s old.
   */
  groups: SignerGroupName[];
  /**
   * SYNC_MODE=always: every governance member Safe is also checked, in use or idle, this often
   * (paced by the quota left for its period); null otherwise.
   */
  baseline: { safes: number; intervalMs: number } | null;
  /**
   * The oldest listing held for the Safes of `groups` (ISO time), or null; the baseline's other
   * Safes are not counted.
   */
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
   * Why the sweep could not look at the groups, else the most recent failure among the Safes it
   * sweeps whose listing has not been read since (Safe's error text, never a URL), or null.
   */
  lastError: string | null;
  /** How many of the Safes it sweeps the last listing read failed for (retried with backoff). */
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
  for (const key of sweep.fresh) {
    const at = held.get(key)?.snapshot.fetchedAt;
    if (at !== undefined && (oldest === null || at < oldest)) oldest = at;
  }
  for (const key of sweep.safes) {
    const failure = failures.get(key);
    if (!failure) continue;
    failing++;
    if (latest === null || failure.at > latest.at) latest = failure;
  }
  return {
    sweeping: running && paused === null && sweep.safes.length > 0,
    groups: running ? [...sweep.groups] : [],
    baseline: running && sweep.baseline ? { ...sweep.baseline } : null,
    oldestFetchedAt: running && oldest !== null ? new Date(oldest).toISOString() : null,
    budgetUsedThisHour: budgetUsed(now),
    budgetPerHour: env.SYNC_SAFE_HOURLY_BUDGET,
    paused,
    lastError: sweep.error ?? latest?.error ?? null,
    failingSafes: failing,
  };
}
