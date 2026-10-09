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
  safeQuotaExhausted,
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
// While someone uses the app, a watcher (see the watcher section) asks Safe about the member Safes
// the screen depends on: the members of the signature sets on screen that can still be signed and
// whose signature is not valid yet (every SYNC_SAFE_WATCH_MS), and the Safes behind lists on
// screen (every SYNC_SAFE_LIST_WATCH_MS). A check asks for the Safe's most recently modified
// message (one small request) and re-reads the listing only when that changed. Checks go out one
// Safe at a time, within SYNC_SAFE_HOURLY_BUDGET an hour, slower when Safe reports little quota
// left for its period, paused below 10 % of it and during a rate-limit cooldown. Without a key on
// Safe's public service they go at most every SYNC_SAFE_WATCH_KEYLESS_MS (0: never). Nothing is
// checked while nobody uses the app, and nothing for a set that can no longer be signed or a
// member whose signature is valid. A viewer who just signed has their own Safe read a few times
// over two minutes (safeBurst), and a page's "Fetch signatures" reads a set's Safes at once
// (checkSafesNow).
//
// Pages (never JSON) may use a copy the watcher keeps checking without reading Safe again, while
// it is within the watcher's cadence for it (pageSafeListing); JSON keeps the 60 s rule above.
// The watcher starts each check by the time its copy turns one cadence old (earlier when many come
// due together), so a page finds every watched copy within that bound. A Safe whose reads keep
// failing is retried less and less often. Requests read on demand as without the watcher; a
// member whose listing cannot be read shows as unavailable, never as missing.

/** A listing is served for this long after Safe's answer arrived. */
export const SAFE_LISTING_MAX_AGE_MS = 60_000;
// The watcher looks again this often when it has nothing due (and whenever it is nudged).
const WATCH_RECHECK_MS = 5_000;
// Checks start at least this far apart, whatever the cadence.
const WATCH_MIN_SPACING_MS = 250;
// After a Safe's reads failed n times in a row, the watcher waits 15 s x 2^(n-1), at most 5 min,
// before reading it again (safe-api remembers a failed path for 15 s); a success resets it. Pages
// are not held back: a request that needs the Safe still reads it.
const WATCH_RETRY_MS = 15_000;
const WATCH_RETRY_MAX_MS = 300_000;
const HOUR_MS = 3_600_000;
// The watcher pauses while the service reports less than this share of its quota left.
const QUOTA_FLOOR = 0.1;
// The quota guard: what is left of the period's quota above this reserve, spread over the time to
// its reset as if a page were on screen this share of it (about 6 hours a day).
const QUOTA_RESERVE = 0.2;
const ON_SCREEN_DUTY = 0.25;
// A page uses a watched Safe's copy within the watcher's cadence for it, and this much more for a
// copy confirmed while the Safe was watched (the check that replaces it is under way: Safe's
// answer, the one-at-a-time start). A copy older than that is read again, as JSON reads it.
const PAGE_SLACK_MS = 10_000;
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
const failures = new Map<string, Failure>();
let generation = safeClientGeneration();
let versions = 0;
// When each background request was sent, for the last hour.
const spent: number[] = [];

/**
 * A background read not sent: the budget, the quota floor or a cooldown stopped it, it is no
 * longer wanted, or it needed a lookup by hash, which only requests make. Not a failure of the
 * Safe.
 */
class SweepPaused extends Error {
  override name = "SweepPaused";
}

/**
 * How a read asks Safe: "check" asks first whether anything changed since the listing held (one
 * small request) and reads the listing only when it did; "full" reads the listing. A read for a
 * request is "full" unless it says otherwise; a background read "check" (a listing the last run
 * read is always read in full: no check is trusted against it).
 */
type ReadMode = "check" | "full";

type ReadOptions = {
  mode?: ReadMode;
  /** A background read the viewer asked for or the screen needs: allowed without a key. */
  keyless?: boolean;
};

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
   * public service without a key).
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
 * The same lookup from the listing held now, without asking Safe: null when there is no listing at
 * most 60 s old, or it cannot tell (the message may be past its last page). For precomputing.
 */
export function peekSafeMessage(safe: Address, messageHash: Hex): SafeMessageLookup | null {
  sync();
  const listing = servable(safe.toLowerCase());
  return listing ? answerFrom(listing, messageHash) : null;
}

/**
 * The listing held for this Safe whatever its age (older than 60 s included), without asking Safe;
 * null when none is held. Only for a page's first answer,
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

/**
 * The lookup answered from this listing (one a caller already holds): the message, or null when
 * the listing cannot tell (it stops before its last page and lacks the message).
 */
export function answerFromListing(
  listing: SafeSnapshot,
  messageHash: Hex
): SafeMessageLookup | null {
  return answerFrom(listing, messageHash);
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

/**
 * Reads the Safe's listing. A background ("low") read is sent only while `wanted()` still holds
 * as each of its requests goes out (the watcher's: someone uses the app and the Safe is on
 * screen); otherwise it stops there (SweepPaused), as for the budget. A request waiting on it
 * lifts that.
 */
function readSafe(
  safe: Address,
  priority: SafeTicket["priority"],
  wanted: () => boolean = () => true,
  options: ReadOptions = {}
): Promise<SafeSnapshot> {
  const key = safe.toLowerCase();
  const running = reads.get(key);
  if (running) {
    if (priority === "low") return running.promise;
    // A request waits on it now: its remaining requests go ahead of background ones.
    running.ticket.priority = "high";
    return running.promise.catch((error: unknown) => {
      // It stopped for a background reason of its own (budget, quota floor, no key for the public
      // service): read for the request.
      if (error instanceof SweepPaused) return readSafe(safe, "high", undefined, options);
      throw error;
    });
  }
  const ticket: SafeTicket = { priority };
  const launched = safeClientGeneration();
  const read: Read = { ticket, promise: runRead(safe, key, ticket, wanted, options) };
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
      ? now + Math.min(WATCH_RETRY_MAX_MS, WATCH_RETRY_MS * 2 ** (inRow - 1))
      : previous?.retryAt ?? 0,
    error: describe(error),
    at: now,
  });
}

async function runRead(
  safe: Address,
  key: string,
  ticket: SafeTicket,
  wanted: () => boolean,
  { mode, keyless = false }: ReadOptions
): Promise<SafeSnapshot> {
  const startGeneration = safeClientGeneration();
  const previous = held.get(key);
  // Background requests (only while nobody waits on them) wait while the watcher is paused,
  // without taking a start slot, and count against the budget as they are sent. One that is no
  // longer wanted (its Safe left the screen, or nobody uses the app now) is not sent at all: a
  // read the watcher queued just before use ended sends nothing after it.
  const options = {
    ticket,
    beforeQueue: () => {
      if (ticket.priority === "low") checkBackgroundRequest(wanted);
    },
    beforeRequest: () => {
      if (ticket.priority === "low") spendBackgroundRequest(wanted);
    },
  };
  if (ticket.priority === "low" && !keyless) {
    // Never in the background on the public service without a key unless the screen needs it
    // (the watcher, the viewer's own signature): its monthly per-IP quota is for the pages that
    // are opened.
    const { safeTxServiceUrl } = await network();
    if (
      ticket.priority === "low" &&
      safeTxServiceUrl &&
      !backgroundSafeReadsAllowed(safeTxServiceUrl)
    )
      throw new SweepPaused("keyless-public-service");
  }
  let checked: NewestMessage | null = null;
  // A check asks first whether anything changed since the listing it holds; never about a
  // listing the last run read (no check is trusted against it: it is read in full).
  const check = (mode ?? (ticket.priority === "low" ? "check" : "full")) === "check";
  if (check && previous && !previous.snapshot.fromLastRun) {
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
function currentQuota(
  now: number
): { limit: number; remaining: number; resetAt: number | null } | null {
  if (quota.limit === null || quota.remaining === null) return null;
  if (quota.resetAt !== null && now >= quota.resetAt) return null;
  return { limit: quota.limit, remaining: quota.remaining, resetAt: quota.resetAt };
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

function checkBackgroundRequest(wanted: () => boolean) {
  const reason = pauseReason(Date.now()) ?? (wanted() ? null : "not-wanted");
  if (reason) throw new SweepPaused(reason);
}

function spendBackgroundRequest(wanted: () => boolean) {
  checkBackgroundRequest(wanted);
  spent.push(Date.now());
}

/** Background reads under way: each sends at least one more request (a changed listing, more). */
function backgroundReads(): number {
  let count = 0;
  for (const read of reads.values()) if (read.ticket.priority === "low") count++;
  return count;
}

// ---- the watcher ----

/**
 * Why a Safe is watched: "set", a member of a signature set on screen that can still be signed,
 * whose signature is not valid at the served head; "list", a Safe a list on screen collects from.
 */
export type WatchKind = "set" | "list";
export type WatchedSafe = { safe: Address; kind: WatchKind };

/** How often each kind of watched Safe is asked about, in ms (Infinity: not at all). */
export type WatchCadence = Record<WatchKind, number>;

export type SafeWatchDriver = {
  /** The sync engine follows the chain and someone uses the app (otherwise: nothing at all). */
  active: () => boolean;
  /** The Safes the screen depends on now (asked again at every look). */
  watched: () => readonly WatchedSafe[];
};

/** The cadences asked for: SYNC_SAFE_WATCH_MS and SYNC_SAFE_LIST_WATCH_MS, slower keyless. */
export function baseWatchCadence(keyless: boolean): WatchCadence {
  const set = env.SYNC_SAFE_WATCH_MS;
  const list = env.SYNC_SAFE_LIST_WATCH_MS;
  const keylessMs = env.SYNC_SAFE_WATCH_KEYLESS_MS;
  return keyless
    ? { set: Math.max(set, keylessMs), list: Math.max(list, keylessMs) }
    : { set, list };
}

/**
 * The quota guard. `counts` Safes of each kind checked at `base` cost counts × 3,600 s / base
 * requests an hour; the guard allows min(SYNC_SAFE_HOURLY_BUDGET, (remaining − 20 % of limit) /
 * (hours to the quota's reset × 0.25)) (the budget alone without quota headers, or once the
 * reported period ended), and stretches every cadence by the same factor when the demand is
 * above it: T_eff = T × max(1, demand / allowance), which for one kind is max(T, N × 3,600 s /
 * allowance). Infinity when nothing is allowed (no budget, nothing left above the reserve).
 */
export function watchCadence(
  counts: Record<WatchKind, number>,
  base: WatchCadence,
  report: QuotaReport = quota,
  now = Date.now(),
  budget: number = env.SYNC_SAFE_HOURLY_BUDGET
): WatchCadence & { allowancePerHour: number } {
  const demand = counts.set * (HOUR_MS / base.set) + counts.list * (HOUR_MS / base.list);
  let allowance = budget;
  const { limit, remaining, resetAt } = report;
  if (limit !== null && remaining !== null && resetAt !== null && resetAt > now) {
    const hours = (resetAt - now) / HOUR_MS;
    allowance = Math.min(allowance, (remaining - QUOTA_RESERVE * limit) / (hours * ON_SCREEN_DUTY));
  }
  if (!(allowance > 0))
    return { set: Number.POSITIVE_INFINITY, list: Number.POSITIVE_INFINITY, allowancePerHour: 0 };
  const factor = Math.max(1, demand / allowance);
  return { set: base.set * factor, list: base.list * factor, allowancePerHour: allowance };
}

type WatchPlan = {
  /** Why nothing is checked here at all (dev node, no service, keyless with checks off), or null. */
  blocked: string | null;
  keyless: boolean;
  base: WatchCadence;
  effective: WatchCadence;
  safes: Map<string, WatchedSafe>;
  counts: Record<WatchKind, number>;
  /** Checks start at least this far apart: the planned rate, one Safe at a time. */
  spacingMs: number;
  /** Why checks wait right now (cooldown, quota, budget), or null. */
  paused: string | null;
  /** When the watcher asks next (ms since the epoch), or null. */
  nextAt: number | null;
  /** The background Safe requests an hour the quota guard allows (see watchCadence). */
  allowancePerHour: number;
};

let watchDriver: SafeWatchDriver | null = null;
let watchTimer: ReturnType<typeof setTimeout> | null = null;
let watchWaking = false;
let watchNudged = false;
let plan: WatchPlan | null = null;
let lastStartAt = Number.NEGATIVE_INFINITY;
let watchError: string | null = null;
// Since when each Safe has been watched without a break (by lower-case address): a copy confirmed
// since then is one the watcher keeps checking (see pageBoundMs). Forgotten once it is not watched.
const watchedSince = new Map<string, number>();

/** Starts the watcher (idempotent); it stops by itself once `driver.active()` says no. */
export function startSafeWatch(next: SafeWatchDriver) {
  watchDriver = next;
  if (watchTimer === null && !watchWaking) scheduleWatch(0);
}

/**
 * Looks at the Safes the screen depends on again now (a page showed a set, a set was verified at a
 * new head, a tab came back): a Safe newly watched whose copy is older than its cadence is asked
 * about at once. The plan (what is watched, at which cadence) is made again at once too, so what a
 * page says about its copies right after (safeCheckOf) uses it, not the one made before.
 */
export function nudgeSafeWatch() {
  if (!watchDriver) return;
  replanNow();
  if (watchWaking) {
    watchNudged = true;
    return;
  }
  scheduleWatch(0);
}

export function stopSafeWatch() {
  watchDriver = null;
  if (watchTimer) clearTimeout(watchTimer);
  watchTimer = null;
  plan = null;
  watchedSince.clear();
  lastStartAt = Number.NEGATIVE_INFINITY;
  stopBursts();
}

function scheduleWatch(ms: number) {
  if (watchTimer) clearTimeout(watchTimer);
  const next = setTimeout(() => void wakeWatch(), Math.max(0, ms));
  (next as { unref?: () => void }).unref?.();
  watchTimer = next;
}

async function wakeWatch() {
  watchTimer = null;
  const current = watchDriver;
  if (!current) return;
  // Nobody uses the app (or the engine stopped): no timer is left; the next use starts it again.
  if (!current.active()) {
    plan = null;
    watchedSince.clear();
    return;
  }
  watchWaking = true;
  watchNudged = false;
  let delay = WATCH_RECHECK_MS;
  try {
    delay = await watchOnce(current);
    watchError = null;
  } catch (error) {
    // The network could not be read: look again shortly.
    watchError = describe(error);
  } finally {
    watchWaking = false;
  }
  if (watchDriver !== null && watchTimer === null) scheduleWatch(watchNudged ? 0 : delay);
}

/** When a watched Safe is due: its copy's confirmation plus its cadence, or its retry time. */
function dueAt(key: string, kind: WatchKind, effective: WatchCadence, now: number): number {
  const entry = held.get(key);
  const confirmed =
    entry && !entry.snapshot.fromLastRun ? entry.snapshot.fetchedAt + effective[kind] : now;
  return Math.max(confirmed, failures.get(key)?.retryAt ?? 0);
}

/**
 * The Safes due for a check, the soonest first, each with the latest time its check may start so
 * that it and every one due after it start by their due times, one at a time `spacingMs` apart
 * (`startBy`): when many come due together (copies a page just read, all at once), the first ones
 * start early, so none starts late and every copy stays within its cadence.
 */
function checkQueue(
  current: WatchPlan,
  now: number
): { key: string; safe: Address; due: number; startBy: number }[] {
  const queue: { key: string; safe: Address; due: number; startBy: number }[] = [];
  for (const [key, watched] of current.safes)
    if (!reads.has(key))
      queue.push({
        key,
        safe: watched.safe,
        due: dueAt(key, watched.kind, current.effective, now),
        startBy: 0,
      });
  queue.sort((a, b) => a.due - b.due);
  let next = Number.POSITIVE_INFINITY;
  for (let i = queue.length - 1; i >= 0; i--) {
    const entry = queue[i] as (typeof queue)[number];
    next = Math.min(entry.due, next - current.spacingMs);
    entry.startBy = next;
  }
  return queue;
}

/**
 * The watcher's plan from what the screen depends on now (`blocked`/`keyless` from the network's
 * settings): the Safes watched and why, their cadences under the quota guard, the spacing of
 * checks, and why checks wait. Also notes since when each Safe is watched.
 */
function makePlan(
  current: SafeWatchDriver,
  keyless: boolean,
  blocked: string | null,
  now: number
): WatchPlan {
  const safes = new Map<string, WatchedSafe>();
  for (const watched of current.watched()) {
    const key = watched.safe.toLowerCase();
    const known = safes.get(key);
    // A Safe both a set and a list need is checked at the set's (shorter) cadence.
    if (!known || (known.kind === "list" && watched.kind === "set")) safes.set(key, watched);
  }
  const counts: Record<WatchKind, number> = { set: 0, list: 0 };
  for (const watched of safes.values()) counts[watched.kind]++;
  for (const key of safes.keys()) if (!watchedSince.has(key)) watchedSince.set(key, now);
  for (const key of [...watchedSince.keys()]) if (!safes.has(key)) watchedSince.delete(key);
  const base = baseWatchCadence(keyless);
  const guarded = watchCadence(counts, base, quota, now);
  const effective = { set: guarded.set, list: guarded.list };
  const perHour =
    (counts.set > 0 ? counts.set * (HOUR_MS / effective.set) : 0) +
    (counts.list > 0 ? counts.list * (HOUR_MS / effective.list) : 0);
  const spacingMs =
    perHour > 0 && Number.isFinite(HOUR_MS / perHour)
      ? Math.max(WATCH_MIN_SPACING_MS, HOUR_MS / perHour)
      : WATCH_RECHECK_MS;
  const paused =
    blocked !== null || safes.size === 0
      ? null
      : pauseReason(now) ??
        (guarded.allowancePerHour > 0
          ? null
          : env.SYNC_SAFE_HOURLY_BUDGET === 0
            ? "budget"
            : "quota");
  return {
    blocked,
    keyless,
    base,
    effective,
    safes,
    counts,
    spacingMs,
    paused,
    nextAt: null,
    allowancePerHour: guarded.allowancePerHour,
  };
}

/**
 * The plan made again now from the settings the last one was made with (nudgeSafeWatch): what a
 * page says about its copies right after a set came on screen uses the Safes and cadences that
 * include it. Nothing when there is no plan (nobody uses the app, or the first is being made).
 */
function replanNow() {
  const current = watchDriver;
  const last = plan;
  if (!current || !last || !current.active()) return;
  sync();
  const next = makePlan(current, last.keyless, last.blocked, Date.now());
  next.nextAt = last.nextAt;
  plan = next;
}

/** Starts the check that is due (at most one per spacing); returns when to look again. */
async function watchOnce(current: SafeWatchDriver): Promise<number> {
  sync();
  const net = await network();
  if (!current.active()) {
    plan = null;
    watchedSince.clear();
    return WATCH_RECHECK_MS;
  }
  const keyless = !!net.safeTxServiceUrl && !backgroundSafeReadsAllowed(net.safeTxServiceUrl);
  // (A dev node is watched too, while the driver says someone uses the app: Safe is not the chain.)
  const blocked = !net.safeTxServiceUrl
    ? "no-service"
    : keyless && env.SYNC_SAFE_WATCH_KEYLESS_MS === 0
      ? "keyless-public-service"
      : null;
  const now = Date.now();
  plan = makePlan(current, keyless, blocked, now);
  const { safes, spacingMs, paused } = plan;
  if (blocked !== null || safes.size === 0 || paused !== null) return WATCH_RECHECK_MS;

  // The Safe due first, and when its check must start for none to start late (checkQueue).
  const first = checkQueue(plan, now)[0];
  // One Safe at a time: the next start no earlier than the spacing after the last one (a clock
  // stepped back never holds it up for longer than that).
  if (lastStartAt > now) lastStartAt = now;
  const notBefore = lastStartAt + spacingMs;
  if (!first) {
    plan.nextAt = null;
    return WATCH_RECHECK_MS;
  }
  const startAt = Math.max(first.startBy, notBefore);
  if (startAt > now) {
    plan.nextAt = startAt;
    return Math.max(WATCH_MIN_SPACING_MS, Math.min(WATCH_RECHECK_MS, startAt - now));
  }
  // A read under way sends at least one more request: only as many as the budget has room for.
  if (env.SYNC_SAFE_HOURLY_BUDGET - budgetUsed(now) - backgroundReads() <= 0) {
    plan.paused = "budget";
    return WATCH_RECHECK_MS;
  }
  lastStartAt = now;
  const { key } = first;
  void readSafe(first.safe, "low", () => watchWants(key), { mode: "check", keyless: true }).catch(
    () => {
      // Noted by readSafe (and retried with backoff while the Safe is still watched).
    }
  );
  plan.nextAt = now + spacingMs;
  return Math.max(WATCH_MIN_SPACING_MS, Math.min(spacingMs, WATCH_RECHECK_MS));
}

/**
 * The watcher still wants this Safe read, as one of its requests goes out: someone uses the app
 * and the screen still depends on the Safe (a read started just before the page left, or before
 * the member's signature became valid, sends nothing more).
 */
function watchWants(key: string): boolean {
  const current = watchDriver;
  if (!current?.active()) return false;
  return current.watched().some((watched) => watched.safe.toLowerCase() === key);
}

// ---- what pages may use ----

/** Which page rule applies: a signature set's member, or a list's source. */
export type PageRule = WatchKind;

/**
 * How old a copy of this Safe confirmed at `fetchedAt` a page may use: the watcher's cadence for
 * it (the effective one, as the quota guard stretches it), and 10 s more when the copy was
 * confirmed while the Safe was watched (its next check starts by then: see checkQueue; a copy the
 * page that put it on screen read a moment before the watcher planned counts too), while the
 * watcher checks it for the screen now (for "set", as a set's member); null when it does not
 * (nobody uses the app, the Safe is not watched, checks are off or paused for good). A copy read
 * before the Safe was watched (a start's warm-up, an earlier page) counts only within the cadence.
 */
function pageBoundMs(key: string, rule: PageRule, fetchedAt: number): number | null {
  const current = plan;
  if (!current || current.blocked !== null) return null;
  const watched = current.safes.get(key);
  if (!watched || (rule === "set" && watched.kind !== "set")) return null;
  const cadence = current.effective[watched.kind];
  if (!Number.isFinite(cadence)) return null;
  const since = watchedSince.get(key);
  return since !== undefined && fetchedAt >= since - PAGE_SLACK_MS
    ? cadence + PAGE_SLACK_MS
    : cadence;
}

/**
 * The listing a page (never JSON) may use for this Safe without asking Safe: one at most 60 s
 * old, or one the watcher keeps checking for the screen, confirmed within its bound (see
 * pageBoundMs). null otherwise (the page then reads it as JSON would), and never the last run's.
 * Safe data is candidate input only: an older copy can only show fewer signatures than there are.
 */
export function pageSafeListing(safe: Address, rule: PageRule): SafeSnapshot | null {
  sync();
  const key = safe.toLowerCase();
  const entry = held.get(key);
  if (!entry || entry.snapshot.fromLastRun) return null;
  const age = Date.now() - entry.snapshot.fetchedAt;
  if (age <= SAFE_LISTING_MAX_AGE_MS) return entry.snapshot;
  const bound = pageBoundMs(key, rule, entry.snapshot.fetchedAt);
  return bound !== null && age <= bound ? entry.snapshot : null;
}

/** For a page: pageSafeListing, else read at the request's priority (as listSafeMessages). */
export function listSafeMessagesForPage(safe: Address, rule: PageRule): Promise<SafeSnapshot> {
  const listing = pageSafeListing(safe, rule);
  return listing ? Promise.resolve(listing) : listSafeMessages(safe);
}

/** How the copies of a set's watched members are kept, for a page's label (see safeCheckOf). */
export type SafeCheck = {
  /** "watching": checked every `cadenceMs`; "paused": not now (see `reason`); "on-request": only
   * when a page loads or Fetch signatures is pressed (no Safe key, keyless checks off); "off":
   * nobody uses the app, or there is no Safe service. */
  state: "watching" | "paused" | "on-request" | "off";
  /** When Safe last confirmed the oldest of the copies (ISO), or null when one is not held. */
  checkedAt: string | null;
  /** When the next of them is checked (ISO; now when one is overdue), or null when none is. */
  nextAt: string | null;
  cadenceMs: number | null;
  reason: string | null;
};

/**
 * What a page says about how its copies of these Safes are kept: the watched members of a set
 * ("set"), or the Safes a list on screen collects from ("list", checked at the list cadence).
 */
export function safeCheckOf(safes: readonly Address[], kind: WatchKind = "set"): SafeCheck {
  sync();
  const current = plan;
  let oldest: number | null = null;
  let missing = false;
  for (const safe of safes) {
    const entry = held.get(safe.toLowerCase());
    if (!entry || entry.snapshot.fromLastRun) missing = true;
    else if (oldest === null || entry.snapshot.fetchedAt < oldest)
      oldest = entry.snapshot.fetchedAt;
  }
  const checkedAt = missing || oldest === null ? null : new Date(oldest).toISOString();
  // Safe's monthly quota used up is said as such, not as a short pause.
  const why = (reason: string) =>
    reason === "cooldown" && safeQuotaExhausted() ? "quota-exhausted" : reason;
  if (current?.blocked === "keyless-public-service")
    return { state: "on-request", checkedAt, nextAt: null, cadenceMs: null, reason: null };
  if (!current || current.blocked !== null) {
    // Not planned yet (the watcher plans again as use resumes): a cooldown still says why.
    const cooling = current === null && safeCooldownUntil() !== null;
    return cooling
      ? { state: "paused", checkedAt, nextAt: null, cadenceMs: null, reason: why("cooldown") }
      : { state: "off", checkedAt, nextAt: null, cadenceMs: null, reason: null };
  }
  const cadence = current.effective[kind];
  const paused = pauseReason(Date.now()) ?? current.paused;
  if (paused !== null || !Number.isFinite(cadence))
    return {
      state: "paused",
      checkedAt,
      nextAt: null,
      cadenceMs: null,
      reason: why(paused ?? "quota"),
    };
  const now = Date.now();
  // When each watched Safe's check starts: one at a time, the spacing apart, the most overdue
  // first (as watchOnce starts them), not merely when its copy comes due.
  const starts = plannedStarts(current, now);
  let next = Number.POSITIVE_INFINITY;
  for (const safe of safes) {
    const key = safe.toLowerCase();
    // A set's members are checked at the set's cadence (a plan made before the set came on
    // screen may still have one as a list's Safe).
    const watched = kind === "set" ? "set" : current.safes.get(key)?.kind ?? kind;
    const start = reads.has(key)
      ? now
      : current.safes.get(key)?.kind === watched
        ? starts.get(key)
        : undefined;
    next = Math.min(next, start ?? dueAt(key, watched, current.effective, now));
  }
  return {
    state: "watching",
    checkedAt,
    nextAt: Number.isFinite(next) ? new Date(Math.max(now, next)).toISOString() : null,
    cadenceMs: Math.round(cadence),
    reason: null,
  };
}

/**
 * When the watcher would start each watched Safe's check (ms since the epoch), as watchOnce does:
 * one at a time, at least the spacing apart, the one due first first, each by the time it must
 * start for none to start late (checkQueue's `startBy`).
 */
function plannedStarts(current: WatchPlan, now: number): Map<string, number> {
  const starts = new Map<string, number>();
  let free = Math.max(now, Math.min(lastStartAt, now) + current.spacingMs);
  for (const { key, startBy } of checkQueue(current, now)) {
    const start = Math.max(startBy, free);
    starts.set(key, start);
    free = start + current.spacingMs;
  }
  return starts;
}

// ---- the viewer's own signature, and "Fetch signatures" ----

// After the viewer signed: at once, every 5 s for 30 s, then every 15 s up to 2 min.
const BURST_AT_MS = [
  0, 5_000, 10_000, 15_000, 20_000, 25_000, 30_000, 45_000, 60_000, 75_000, 90_000, 105_000,
  120_000,
] as const;

type Burst = {
  timer: ReturnType<typeof setTimeout> | null;
  /** The listing's version when it started: a new one ends it. */
  version: number | null;
  step: number;
  generation: number;
  wanted: () => boolean;
};
const bursts = new Map<string, Burst>();

/**
 * The viewer just signed for this member Safe: reads its listing at once, then every 5 s for 30 s
 * and every 15 s up to 2 min (13 reads at most), and stops at the first new version of the
 * listing (by this burst, the watcher or a request) or once `wanted()` no longer holds (nobody
 * uses the app). Allowed without a key; it counts toward SYNC_SAFE_HOURLY_BUDGET and stops when
 * that is spent, below 10 % of the quota or during a cooldown. False when one already runs.
 */
export function safeBurst(safe: Address, wanted: () => boolean): boolean {
  sync();
  const key = safe.toLowerCase();
  if (bursts.has(key)) return false;
  const burst: Burst = {
    timer: null,
    version: held.get(key)?.snapshot.version ?? null,
    step: 0,
    generation: safeClientGeneration(),
    wanted,
  };
  bursts.set(key, burst);
  scheduleBurst(key, safe, burst, 0);
  return true;
}

function scheduleBurst(key: string, safe: Address, burst: Burst, delay: number) {
  const timer = setTimeout(() => void burstStep(key, safe, burst), delay);
  (timer as { unref?: () => void }).unref?.();
  burst.timer = timer;
}

async function burstStep(key: string, safe: Address, burst: Burst) {
  burst.timer = null;
  const live = () =>
    bursts.get(key) === burst && burst.generation === safeClientGeneration() && burst.wanted();
  const end = () => {
    if (bursts.get(key) === burst) bursts.delete(key);
  };
  const version = () => held.get(key)?.snapshot.version ?? null;
  if (!live() || version() !== burst.version || pauseReason(Date.now()) !== null) return end();
  try {
    await readSafe(safe, "low", live, { mode: "full", keyless: true });
  } catch (error) {
    // Out of budget or quota, or no longer wanted: done. Another failure: the next step reads.
    if (error instanceof SweepPaused) return end();
  }
  if (bursts.get(key) !== burst) return;
  // Nothing was held when it started: the first read is what the others are compared with.
  if (burst.step === 0 && burst.version === null) burst.version = version();
  if (version() !== burst.version) return end();
  burst.step++;
  const at = BURST_AT_MS[burst.step];
  const before = BURST_AT_MS[burst.step - 1] ?? 0;
  if (at === undefined || !live()) return end();
  scheduleBurst(key, safe, burst, at - before);
}

/** Bursts running now (the viewer's own Safe read after they signed). */
export function burstsRunning(): number {
  return bursts.size;
}

function stopBursts() {
  for (const burst of bursts.values()) if (burst.timer) clearTimeout(burst.timer);
  bursts.clear();
}

/**
 * "Fetch signatures" / "Check Safe now": asks Safe about these Safes now, at a request's priority
 * (ahead of the watcher, within the same pacer: one start at a time, at most 4 in flight),
 * whatever their copies' age; a read already in flight is joined. Never rejects: `failed` names
 * the Safes Safe did not answer for (their members then show as unavailable, never missing).
 */
export async function checkSafesNow(
  safes: readonly Address[]
): Promise<{ checked: number; failed: Address[] }> {
  sync();
  const unique = new Map(safes.map((safe) => [safe.toLowerCase(), safe] as const));
  const failed: Address[] = [];
  let checked = 0;
  await Promise.all(
    [...unique].map(async ([, safe]) => {
      try {
        await readSafe(safe, "high", undefined, { mode: "check" });
        checked++;
      } catch {
        failed.push(safe);
      }
    })
  );
  return { checked, failed };
}

/** A Safe API error's text (no URL or key in it), else only the error's class name. */
function describe(error: unknown): string {
  if (error instanceof SafeApiError) return error.message;
  const name = error instanceof Error ? error.name : typeof error;
  return /^[A-Za-z]\w{0,63}$/.test(name) ? name : "Error";
}

export type SafeStoreStatus = {
  /** The watcher is checking Safes the screen depends on right now (not paused, not blocked). */
  sweeping: boolean;
  /** Kept for older readers: always empty (the watcher works per Safe, not per signer group). */
  groups: string[];
  /** Kept for older readers: always null (nothing is checked while nobody uses the app). */
  baseline: null;
  /**
   * What the watcher checks while someone uses the app: `safes` members of open sets on screen
   * not valid yet and `lists` Safes behind lists on screen, the cadences asked for and those the
   * quota guard allows (null: none allowed), when the next check is, and whether Safe is used
   * without a key. null while nobody uses the app.
   */
  watched: {
    safes: number;
    lists: number;
    keyless: boolean;
    cadenceMs: WatchCadence;
    effectiveCadenceMs: Record<WatchKind, number | null>;
    /**
     * Background Safe requests an hour the quota guard allows: SYNC_SAFE_HOURLY_BUDGET, or less
     * when Safe reports little quota left for the rest of its period. Cadences stretch to fit it.
     */
    allowancePerHour: number;
    nextCheckAt: string | null;
  } | null;
  /** The oldest copy held of a watched Safe (ISO time), or null. */
  oldestFetchedAt: string | null;
  /** Background requests sent in the last hour (watcher and bursts), and the hourly budget. */
  budgetUsedThisHour: number;
  budgetPerHour: number;
  /** Safes being read after the viewer signed (safeBurst). */
  bursts: number;
  /**
   * Why the watcher is not checking: idle (nobody uses the app, or the engine is off), no-service,
   * keyless-public-service (SYNC_SAFE_WATCH_KEYLESS_MS=0), cooldown, quota, budget; null when it
   * is (or has nothing to check).
   */
  paused: string | null;
  /** The most recent failure among the watched Safes (Safe's error text, never a URL), or null. */
  lastError: string | null;
  /** How many of the watched Safes the last listing read failed for (retried with backoff). */
  failingSafes: number;
};

const finite = (ms: number) => (Number.isFinite(ms) ? Math.round(ms) : null);

/** What the watcher is doing, for /api/status. */
export function safeStoreStatus(): SafeStoreStatus {
  sync();
  const now = Date.now();
  const current = watchDriver?.active() ? plan : null;
  // Paused as of now (a cooldown or the quota can start between two looks), else as last planned.
  const paused = !current
    ? "idle"
    : current.blocked ?? (current.safes.size > 0 ? pauseReason(now) : null) ?? current.paused;
  let oldest: number | null = null;
  let latest: Failure | null = null;
  let failing = 0;
  for (const key of current?.safes.keys() ?? []) {
    const at = held.get(key)?.snapshot.fetchedAt;
    if (at !== undefined && (oldest === null || at < oldest)) oldest = at;
    const failure = failures.get(key);
    if (!failure) continue;
    failing++;
    if (latest === null || failure.at > latest.at) latest = failure;
  }
  return {
    sweeping: current !== null && paused === null && current.safes.size > 0,
    groups: [],
    baseline: null,
    watched: current && {
      safes: current.counts.set,
      lists: current.counts.list,
      keyless: current.keyless,
      cadenceMs: { ...current.base },
      effectiveCadenceMs: {
        set: finite(current.effective.set),
        list: finite(current.effective.list),
      },
      allowancePerHour: Math.max(0, Math.floor(current.allowancePerHour)),
      nextCheckAt: current.nextAt === null ? null : new Date(current.nextAt).toISOString(),
    },
    oldestFetchedAt: oldest === null ? null : new Date(oldest).toISOString(),
    budgetUsedThisHour: budgetUsed(now),
    budgetPerHour: env.SYNC_SAFE_HOURLY_BUDGET,
    bursts: bursts.size,
    paused,
    lastError: watchError ?? latest?.error ?? null,
    failingSafes: failing,
  };
}
