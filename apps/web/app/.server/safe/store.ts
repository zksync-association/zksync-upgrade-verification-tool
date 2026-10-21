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

// Member Safes' message listings: candidate input only. A signature counts once the governance
// contract accepts it in an eth_call, whatever Safe says.
//
// JSON uses a listing at most 60 s old (from Safe's answer); an older one is read again for the
// request, ahead of background reads, and callers share one read. While someone uses the app the
// watcher checks the Safes the screen depends on (open sets' members not valid yet, Safe-fed
// lists) within the hourly budget and Safe's quota, and a page may use a watched copy within the
// watcher's cadence. A member whose listing cannot be read is unavailable, never missing.

export const SAFE_LISTING_MAX_AGE_MS = 60_000;
const WATCH_RECHECK_MS = 5_000;
const WATCH_MIN_SPACING_MS = 250;
// Checks are planned at this share of the allowed rate; the rest is room to catch up.
export const WATCH_UTILISATION = 0.8;
// After n failed reads in a row: 15 s × 2^(n-1), at most 5 min (requests still read the Safe).
const WATCH_RETRY_MS = 15_000;
const WATCH_RETRY_MAX_MS = 300_000;
const HOUR_MS = 3_600_000;
const QUOTA_FLOOR = 0.1;
// The quota guard spreads what is left above this reserve over the time to the quota's reset, as
// if a page were on screen this share of it (about 6 hours a day).
const QUOTA_RESERVE = 0.2;
const ON_SCREEN_DUTY = 0.25;
// A page may use a watched copy within its cadence, plus this while its next check is under way.
const PAGE_SLACK_MS = 10_000;
const KEY_PREFIX = "safe:list:";

export type SafeSnapshot = SafeMessages & {
  fetchedAt: number;
  /** Changes whenever the content changes (never reused); kept when it does not. */
  version: number;
  /** Read by the last run (chain cache): only a page's labelled first answer may use it. */
  fromLastRun?: true;
};

type Held = {
  snapshot: SafeSnapshot;
  fingerprint: string;
  newest: NewestMessage | null;
};

type Read = { ticket: SafeTicket; promise: Promise<SafeSnapshot> };

type Failure = {
  inRow: number;
  retryAt: number;
  error: string;
  at: number;
};

const held = new Map<string, Held>();
const reads = new Map<string, Read>();
const failures = new Map<string, Failure>();
let generation = safeClientGeneration();
let versions = 0;
const spent: number[] = [];

/** A background read not sent (budget, quota, cooldown, unwanted): not a failure of the Safe. */
class SweepPaused extends Error {
  override name = "SweepPaused";
}

/**
 * "check" asks first whether anything changed (one small request), "full" reads the listing. A
 * listing the last run read is always read in full: no check is trusted against it.
 */
type ReadMode = "check" | "full";

type ReadOptions = {
  mode?: ReadMode;
  keyless?: boolean;
};

function drop(prefix: string | null) {
  const covered = (key: string) => prefix === null || `${KEY_PREFIX}${key}`.startsWith(prefix);
  for (const map of [held, reads, failures])
    for (const key of [...map.keys()]) if (covered(key)) map.delete(key);
}

// refreshSafeData(), settings changes and dev-node refreshes empty this store like the cache.
linkStore(KEY_PREFIX, drop);

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
  /** For reads nobody waits on: behind every request's, within the hourly background budget. */
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

/** Prefers the listing to save quota; a background lookup never asks Safe by hash. */
export async function findSafeMessage(
  safe: Address,
  messageHash: Hex,
  options: SafeReadOptions = {}
): Promise<SafeMessage | null> {
  return (await lookupSafeMessage(safe, messageHash, options)).message;
}

export type SafeMessageLookup = {
  message: SafeMessage | null;
  /** The listing version that answered; null when Safe was asked by hash. */
  version: number | null;
  fetchedAt: number | null;
  fromLastRun?: true;
};

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

export function peekSafeMessage(safe: Address, messageHash: Hex): SafeMessageLookup | null {
  sync();
  const listing = servable(safe.toLowerCase());
  return listing ? answerFrom(listing, messageHash) : null;
}

/**
 * The listing held, whatever its age: only for a page's labelled first answer. An old copy can
 * only show fewer signatures than there are, never make one count.
 */
export function heldSafeListing(safe: Address): SafeSnapshot | null {
  sync();
  return held.get(safe.toLowerCase())?.snapshot ?? null;
}

export function peekHeldSafeMessage(safe: Address, messageHash: Hex): SafeMessageLookup | null {
  const listing = heldSafeListing(safe);
  return listing ? answerFrom(listing, messageHash) : null;
}

/** null when the listing cannot tell: it stops before its last page and lacks the message. */
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

/** A result computed from a listing holds while this still names its version. */
export function freshListingVersion(safe: Address): number | null {
  sync();
  return servable(safe.toLowerCase())?.version ?? null;
}

type ListingListener = (safe: Address) => void;
const listeners = new Set<ListingListener>();

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

export function warmSafeListing(safe: Address): Promise<SafeSnapshot> {
  return listSafeMessages(safe, { background: true });
}

export function safeListingVersion(safe: Address): number | null {
  sync();
  return held.get(safe.toLowerCase())?.snapshot.version ?? null;
}

/**
 * A background ("low") read sends each request only while `wanted()` holds (else SweepPaused);
 * a request waiting on it lifts that.
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
    running.ticket.priority = "high";
    return running.promise.catch((error: unknown) => {
      // Stopped for a background reason (budget, quota, no key): read for the request.
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
    // A paused read never reached Safe; one from before a settings change says nothing now.
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
  // Background requests wait while the watcher is paused and count against the budget as they are
  // sent; one no longer wanted (its Safe left the screen, use ended) is never sent.
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
    // Never in the background on the public service without a key unless the screen needs it: its
    // monthly per-IP quota is for the pages.
    const { safeTxServiceUrl } = await network();
    if (
      ticket.priority === "low" &&
      safeTxServiceUrl &&
      !backgroundSafeReadsAllowed(safeTxServiceUrl)
    )
      throw new SweepPaused("keyless-public-service");
  }
  let checked: NewestMessage | null = null;
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
        // Unchanged messages keep their objects: what was derived from them (flows/messages.ts
        // parses and hashes each once) still applies.
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
      // The change check made before the listing when the listing does not show its newest (never
      // newer than the listing, so a change after it is still seen by the next check).
      newest: newestOf(listing) ?? checked,
    },
    startGeneration
  );
}

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

/** As Safe's change check would name it: only for a complete listing with no tie, else null. */
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

export type KeptSafeListing = SafeMessages & { safe: Address; fetchedAt: number };

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

/** Holds the last run's listings for Safes this run has none of; the first read replaces each. */
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

export function dropLastRunListings() {
  for (const [key, entry] of [...held]) if (entry.snapshot.fromLastRun) held.delete(key);
}

// ---- background budget ----

function budgetUsed(now: number): number {
  while (spent.length > 0 && (spent[0] as number) <= now - HOUR_MS) spent.shift();
  return spent.length;
}

/** The quota Safe last reported, while that still describes the current period. */
function currentQuota(
  now: number
): { limit: number; remaining: number; resetAt: number | null } | null {
  if (quota.limit === null || quota.remaining === null) return null;
  if (quota.resetAt !== null && now >= quota.resetAt) return null;
  return { limit: quota.limit, remaining: quota.remaining, resetAt: quota.resetAt };
}

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

function backgroundReads(): number {
  let count = 0;
  for (const read of reads.values()) if (read.ticket.priority === "low") count++;
  return count;
}

// ---- the watcher ----

/** "set": a member of an open set on screen not valid at the served head; "list": a list's Safe. */
export type WatchKind = "set" | "list";
export type WatchedSafe = { safe: Address; kind: WatchKind };

export type WatchCadence = Record<WatchKind, number>;

export type SafeWatchDriver = {
  active: () => boolean;
  watched: () => readonly WatchedSafe[];
};

export function baseWatchCadence(keyless: boolean): WatchCadence {
  const set = env.SYNC_SAFE_WATCH_MS;
  const list = env.SYNC_SAFE_LIST_WATCH_MS;
  const keylessMs = env.SYNC_SAFE_WATCH_KEYLESS_MS;
  return keyless
    ? { set: Math.max(set, keylessMs), list: Math.max(list, keylessMs) }
    : { set, list };
}

/**
 * The quota guard: the allowance is min(budget, (remaining − 20 % of limit) / (hours to reset ×
 * 0.25)), and every cadence stretches by max(1, demand / (0.8 × allowance)). Infinity: none.
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
  const factor = Math.max(1, demand / (WATCH_UTILISATION * allowance));
  return { set: base.set * factor, list: base.list * factor, allowancePerHour: allowance };
}

type WatchPlan = {
  blocked: string | null;
  keyless: boolean;
  base: WatchCadence;
  effective: WatchCadence;
  safes: Map<string, WatchedSafe>;
  counts: Record<WatchKind, number>;
  spacingMs: number;
  paused: string | null;
  nextAt: number | null;
  allowancePerHour: number;
};

let watchDriver: SafeWatchDriver | null = null;
let watchTimer: ReturnType<typeof setTimeout> | null = null;
let watchWaking = false;
let watchNudged = false;
let plan: WatchPlan | null = null;
let lastStartAt = Number.NEGATIVE_INFINITY;
let watchError: string | null = null;
const watchedSince = new Map<string, number>();

export function startSafeWatch(next: SafeWatchDriver) {
  watchDriver = next;
  if (watchTimer === null && !watchWaking) scheduleWatch(0);
}

/** Looks again now (a set came on screen, a tab came back), replanning at once for safeCheckOf. */
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
    watchError = describe(error);
  } finally {
    watchWaking = false;
  }
  if (watchDriver !== null && watchTimer === null) scheduleWatch(watchNudged ? 0 : delay);
}

function dueAt(key: string, kind: WatchKind, effective: WatchCadence, now: number): number {
  const entry = held.get(key);
  const confirmed =
    entry && !entry.snapshot.fromLastRun ? entry.snapshot.fetchedAt + effective[kind] : now;
  return Math.max(confirmed, failures.get(key)?.retryAt ?? 0);
}

type Queued = { key: string; safe: Address; kind: WatchKind; due: number; startBy: number };

function retrying(key: string): boolean {
  return (failures.get(key)?.inRow ?? 0) > 0;
}

/**
 * The Safes due: `kept` with `startBy`, the latest start that keeps every check by its due time (a
 * bunch read together is spread over one cadence); `retries` take only starts no kept copy needs.
 */
function checkQueue(current: WatchPlan, now: number): { kept: Queued[]; retries: Queued[] } {
  const kept: Queued[] = [];
  const retries: Queued[] = [];
  for (const [key, watched] of current.safes)
    if (!reads.has(key))
      (retrying(key) ? retries : kept).push({
        key,
        safe: watched.safe,
        kind: watched.kind,
        due: dueAt(key, watched.kind, current.effective, now),
        startBy: 0,
      });
  kept.sort((a, b) => a.due - b.due);
  retries.sort((a, b) => a.due - b.due);
  for (const kind of ["set", "list"] as const) {
    const cadence = current.effective[kind];
    const count = current.counts[kind];
    if (!Number.isFinite(cadence) || count < 2) continue;
    const gap = cadence / count;
    const spread = kept.filter((entry) => entry.kind === kind);
    for (let i = spread.length - 2; i >= 0; i--) {
      const entry = spread[i] as Queued;
      entry.due = Math.min(entry.due, (spread[i + 1] as Queued).due - gap);
    }
  }
  kept.sort((a, b) => a.due - b.due);
  let next = Number.POSITIVE_INFINITY;
  for (let i = kept.length - 1; i >= 0; i--) {
    const entry = kept[i] as Queued;
    next = Math.min(entry.due, next - current.spacingMs);
    entry.startBy = next;
  }
  for (const entry of retries) entry.startBy = entry.due;
  return { kept, retries };
}

function nextCheck(
  queue: { kept: Queued[]; retries: Queued[] },
  spacingMs: number,
  notBefore: number,
  now: number
): { start: Queued | null; at: number } {
  const first = queue.kept[0];
  const keptAt = first ? Math.max(first.startBy, notBefore) : Number.POSITIVE_INFINITY;
  if (first && keptAt <= now) return { start: first, at: now };
  const retry = queue.retries[0];
  if (retry) {
    const retryAt = Math.max(retry.due, notBefore, now);
    if (!first || retryAt + spacingMs <= first.startBy)
      return retryAt <= now
        ? { start: retry, at: now }
        : { start: null, at: Math.min(keptAt, retryAt) };
  }
  return { start: null, at: keptAt };
}

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
      ? Math.max(WATCH_MIN_SPACING_MS, (WATCH_UTILISATION * HOUR_MS) / perHour)
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

function replanNow() {
  const current = watchDriver;
  const last = plan;
  if (!current || !last || !current.active()) return;
  sync();
  const next = makePlan(current, last.keyless, last.blocked, Date.now());
  next.nextAt = last.nextAt;
  plan = next;
}

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

  // One Safe at a time, the spacing apart (a clock stepped back never holds it up for longer).
  if (lastStartAt > now) lastStartAt = now;
  const { start: first, at: startAt } = nextCheck(
    checkQueue(plan, now),
    spacingMs,
    lastStartAt + spacingMs,
    now
  );
  if (!first) {
    plan.nextAt = Number.isFinite(startAt) ? startAt : null;
    return Number.isFinite(startAt)
      ? Math.max(WATCH_MIN_SPACING_MS, Math.min(WATCH_RECHECK_MS, startAt - now))
      : WATCH_RECHECK_MS;
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

/** Still wanted as each request goes out: in use, and the screen still depends on the Safe. */
function watchWants(key: string): boolean {
  const current = watchDriver;
  if (!current?.active()) return false;
  return current.watched().some((watched) => watched.safe.toLowerCase() === key);
}

// ---- what pages may use ----

export type PageRule = WatchKind;

/**
 * How old a copy a page may use: the watcher's effective cadence for it, plus PAGE_SLACK_MS for a
 * copy confirmed while watched; null when the Safe is not watched for the screen.
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
 * A page's (never JSON's) copy without asking Safe: at most 60 s old, or watched and within its
 * bound; never the last run's. An older copy can only show fewer signatures than there are.
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

export function listSafeMessagesForPage(safe: Address, rule: PageRule): Promise<SafeSnapshot> {
  const listing = pageSafeListing(safe, rule);
  return listing ? Promise.resolve(listing) : listSafeMessages(safe);
}

export type SafeCheck = {
  /** "on-request": only on a page load or Fetch signatures (no key, keyless checks off); "off":
   * nobody uses the app, or there is no Safe service. */
  state: "watching" | "paused" | "on-request" | "off";
  checkedAt: string | null;
  nextAt: string | null;
  cadenceMs: number | null;
  reason: string | null;
};

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
  const why = (reason: string) =>
    reason === "cooldown" && safeQuotaExhausted() ? "quota-exhausted" : reason;
  if (current?.blocked === "keyless-public-service") {
    // Without a key Safe is read only on request, and not even then during a cooldown: say why.
    return safeCooldownUntil() !== null
      ? { state: "paused", checkedAt, nextAt: null, cadenceMs: null, reason: why("cooldown") }
      : { state: "on-request", checkedAt, nextAt: null, cadenceMs: null, reason: null };
  }
  if (!current || current.blocked !== null) {
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
  const starts = plannedStarts(current, now);
  let next = Number.POSITIVE_INFINITY;
  for (const safe of safes) {
    const key = safe.toLowerCase();
    // A set's members at the set's cadence (an older plan may still have one as a list's Safe).
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

function plannedStarts(current: WatchPlan, now: number): Map<string, number> {
  const starts = new Map<string, number>();
  const first = Math.max(now, Math.min(lastStartAt, now) + current.spacingMs);
  let free = first;
  const { kept, retries } = checkQueue(current, now);
  for (const { key, startBy } of kept) {
    const start = Math.max(startBy, free);
    starts.set(key, start);
    free = start + current.spacingMs;
  }
  for (const { key, due } of retries) starts.set(key, Math.max(due, first));
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
  version: number | null;
  step: number;
  generation: number;
  wanted: () => boolean;
};
const bursts = new Map<string, Burst>();

/** The viewer just signed: reads the Safe up to 13 times over 2 min, until its listing changes. */
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

export function burstsRunning(): number {
  return bursts.size;
}

function stopBursts() {
  for (const burst of bursts.values()) if (burst.timer) clearTimeout(burst.timer);
  bursts.clear();
}

/** Reads these Safes now at a request's priority; `failed` names those Safe did not answer for. */
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
  sweeping: boolean;
  watched: {
    safes: number;
    lists: number;
    keyless: boolean;
    cadenceMs: WatchCadence;
    effectiveCadenceMs: Record<WatchKind, number | null>;
    allowancePerHour: number;
    nextCheckAt: string | null;
  } | null;
  oldestFetchedAt: string | null;
  budgetUsedThisHour: number;
  budgetPerHour: number;
  bursts: number;
  /** idle, no-service, keyless-public-service, cooldown, quota or budget; null while checking. */
  paused: string | null;
  /** The most recent failure among the watched Safes (Safe's error text, never a URL), or null. */
  lastError: string | null;
  failingSafes: number;
};

const finite = (ms: number) => (Number.isFinite(ms) ? Math.round(ms) : null);

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
