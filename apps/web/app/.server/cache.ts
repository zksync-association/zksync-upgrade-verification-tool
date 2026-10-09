import { isEngineWork, requestJoinsEngineWork } from "./sync/pacer";

// In-memory memoization. There is no database: anything worth keeping between requests lives here
// for the lifetime of the process, and everything can be rebuilt from chain or Safe on a restart.
// A request joining a read the sync engine started lets that paced read go at once (sync/pacer.ts).

type Entry<T> = { value: Promise<T>; expiresAt: number; engine?: boolean };

function joined<T>(hit: Entry<T>): Promise<T> {
  if (hit.engine) requestJoinsEngineWork(hit.value);
  return hit.value;
}

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
    return joined(hit);
  }

  sweepExpired();
  const value = compute();
  const entry: Entry<T> = { value, expiresAt: FOREVER, engine: isEngineWork() };
  store.set(key, entry);
  // Slow reads still share one promise. Freshness starts when the result arrives,
  // not before the provider has answered; invalidated results are never reinserted.
  value.then(
    () => {
      entry.engine = false;
      if (store.get(key) === entry) entry.expiresAt = Date.now() + ttlMs;
    },
    () => {
      entry.engine = false;
    }
  );
  value.catch(() => {
    if (store.get(key)?.value === value) {
      store.delete(key);
    }
  });
  return value;
}

/**
 * Like cached(), with the TTL known only once the result arrives (a fact read at a final block is
 * kept for good, above it not at all); a TTL <= 0 drops the entry once it resolves.
 */
export function cachedUntil<T>(
  key: string,
  compute: () => Promise<{ value: T; ttlMs: number }>
): Promise<T> {
  const hit = store.get(key) as Entry<T> | undefined;
  if (hit && hit.expiresAt > Date.now()) return joined(hit);

  sweepExpired();
  const result = compute();
  const value = result.then((r) => r.value);
  const entry: Entry<T> = { value, expiresAt: FOREVER, engine: isEngineWork() };
  store.set(key, entry);
  result.then(
    ({ ttlMs }) => {
      entry.engine = false;
      if (store.get(key) !== entry) return;
      if (ttlMs > 0) entry.expiresAt = Date.now() + ttlMs;
      else store.delete(key);
    },
    () => {
      entry.engine = false;
      if (store.get(key) === entry) store.delete(key);
    }
  );
  return value;
}

/** Stores a value in hand unless a live entry is there; never waits on, joins or replaces it. */
export function seed<T>(key: string, value: T, ttlMs: number) {
  if (ttlMs <= 0) return;
  const hit = store.get(key);
  if (hit && hit.expiresAt > Date.now()) return;
  sweepExpired();
  store.set(key, { value: Promise.resolve(value), expiresAt: Date.now() + ttlMs });
}

/** Stores a value in hand in place of any entry; callers of a replaced read get its answer. */
export function replace<T>(key: string, value: T, ttlMs: number) {
  if (ttlMs <= 0) return;
  sweepExpired();
  store.set(key, { value: Promise.resolve(value), expiresAt: Date.now() + ttlMs });
}

export function peek<T>(key: string): Promise<T> | null {
  const hit = store.get(key) as Entry<T> | undefined;
  return hit && hit.expiresAt > Date.now() ? hit.value : null;
}

/** How much longer `key` is served: null when absent or expired, Infinity while in flight. */
export function remainingMs(key: string): number | null {
  const hit = store.get(key);
  if (!hit) return null;
  const left = hit.expiresAt - Date.now();
  return left > 0 ? left : null;
}

// Stores that keep entries outside this map (the Safe snapshot store) under a key prefix: emptied
// by invalidate() and clearCache() too.
const linked = new Map<string, (prefix: string | null) => void>();

/** `drop(prefix)` on an invalidate() that covers `prefix`, `drop(null)` on clearCache(). */
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
