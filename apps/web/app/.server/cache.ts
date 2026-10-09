// In-memory memoization. There is no database: anything worth keeping between requests lives here
// for the lifetime of the process, and everything can be rebuilt from chain or Safe on a restart.

type Entry<T> = { value: Promise<T>; expiresAt: number };

const store = new Map<string, Entry<unknown>>();

export const FOREVER = Number.POSITIVE_INFINITY;

// Entries keyed by a block hash are never asked for again once the head moves on, so expired
// entries are dropped now and then instead of piling up for the life of the process.
const SWEEP_EVERY_MS = 60_000;
let lastSweep = Date.now();

function sweepExpired() {
  const now = Date.now();
  // A clock stepped back (NTP) must not postpone the next sweep until it catches up.
  if (now >= lastSweep && now - lastSweep < SWEEP_EVERY_MS) return;
  lastSweep = now;
  // An entry in flight never expires (FOREVER until it resolves).
  for (const [key, entry] of store) if (entry.expiresAt <= now) store.delete(key);
}

/**
 * Returns the cached value for `key`, or computes it. Concurrent callers share one in-flight
 * promise. Rejections are never cached.
 */
export function cached<T>(key: string, ttlMs: number, compute: () => Promise<T>): Promise<T> {
  if (ttlMs <= 0) return compute();
  const now = Date.now();
  const hit = store.get(key) as Entry<T> | undefined;
  if (hit && hit.expiresAt > now) {
    return hit.value;
  }

  sweepExpired();
  const value = compute();
  const entry = { value, expiresAt: FOREVER };
  store.set(key, entry);
  // Slow reads still share one promise. Freshness starts when the result arrives,
  // not before the provider has answered; invalidated results are never reinserted.
  value.then(
    () => {
      if (store.get(key) === entry) entry.expiresAt = Date.now() + ttlMs;
    },
    () => {}
  );
  value.catch(() => {
    if (store.get(key)?.value === value) {
      store.delete(key);
    }
  });
  return value;
}

/**
 * Like cached(), for a result whose lifetime is known only once it arrives: a fact read at or
 * below the finality boundary is kept for good, the same fact read above it not at all. The
 * compute returns the value and its TTL; a TTL <= 0 drops the entry once it resolves (concurrent
 * callers still share the read in flight). Rejections are never cached.
 */
export function cachedUntil<T>(
  key: string,
  compute: () => Promise<{ value: T; ttlMs: number }>
): Promise<T> {
  const hit = store.get(key) as Entry<T> | undefined;
  if (hit && hit.expiresAt > Date.now()) return hit.value;

  sweepExpired();
  const result = compute();
  const value = result.then((r) => r.value);
  const entry = { value, expiresAt: FOREVER };
  store.set(key, entry);
  result.then(
    ({ ttlMs }) => {
      if (store.get(key) !== entry) return;
      if (ttlMs > 0) entry.expiresAt = Date.now() + ttlMs;
      else store.delete(key);
    },
    () => {
      if (store.get(key) === entry) store.delete(key);
    }
  );
  return value;
}

/**
 * Stores a value already in hand under `key` for `ttlMs`, unless a live entry (resolved or still
 * in flight) is there. Never waits on, joins or replaces that entry, so the caller's result never
 * depends on another caller's read.
 */
export function seed<T>(key: string, value: T, ttlMs: number) {
  if (ttlMs <= 0) return;
  const hit = store.get(key);
  if (hit && hit.expiresAt > Date.now()) return;
  sweepExpired();
  store.set(key, { value: Promise.resolve(value), expiresAt: Date.now() + ttlMs });
}

/**
 * Stores a value already in hand under `key` for `ttlMs`, in place of whatever is there (resolved
 * or still in flight). For values read ahead of requests (the sync engine): callers already
 * waiting on a replaced read still get that read's answer, which is then not stored.
 */
export function replace<T>(key: string, value: T, ttlMs: number) {
  if (ttlMs <= 0) return;
  sweepExpired();
  store.set(key, { value: Promise.resolve(value), expiresAt: Date.now() + ttlMs });
}

/**
 * The entry under `key` (resolved or still in flight) without computing anything: null when there
 * is none or it expired.
 */
export function peek<T>(key: string): Promise<T> | null {
  const hit = store.get(key) as Entry<T> | undefined;
  return hit && hit.expiresAt > Date.now() ? hit.value : null;
}

/**
 * How much longer the entry under `key` is served: null when there is none (or it expired),
 * Infinity while its read is still in flight or when it is kept for good.
 */
export function remainingMs(key: string): number | null {
  const hit = store.get(key);
  if (!hit) return null;
  const left = hit.expiresAt - Date.now();
  return left > 0 ? left : null;
}

// Stores that keep their entries outside this map (the Safe snapshot store), under a key prefix
// of their own: invalidate() and clearCache() empty them too, so "drop cached answers" means the
// same wherever an answer is held.
const linked = new Map<string, (prefix: string | null) => void>();

/**
 * Links a store whose keys start with `prefix`: `drop(prefix)` is called when invalidate() covers
 * some of them, `drop(null)` on clearCache(). A later link for the same prefix replaces it.
 */
export function linkStore(prefix: string, drop: (prefix: string | null) => void) {
  linked.set(prefix, drop);
}

export function invalidate(prefix: string) {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) {
      store.delete(key);
    }
  }
  for (const [own, drop] of linked)
    if (own.startsWith(prefix) || prefix.startsWith(own)) drop(prefix);
}

export function clearCache() {
  store.clear();
  for (const drop of linked.values()) drop(null);
}

/** Entries held, expired ones not yet dropped included. */
export function cacheSize(): number {
  return store.size;
}

/** Runs at most `limit` tasks at once. */
export function concurrencyLimit(limit: number) {
  let active = 0;
  const queue: (() => void)[] = [];

  const next = () => {
    if (active >= limit) return;
    const run = queue.shift();
    if (run) {
      active++;
      run();
    }
  };

  return <T>(task: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      queue.push(() => {
        task()
          .then(resolve, reject)
          .finally(() => {
            active--;
            next();
          });
      });
      next();
    });
}
