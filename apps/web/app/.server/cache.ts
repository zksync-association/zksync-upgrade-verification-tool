// In-memory memoization. There is no database: anything worth keeping between requests lives here
// for the lifetime of the process, and everything can be rebuilt from chain or Safe on a restart.

type Entry<T> = { value: Promise<T>; expiresAt: number };

const store = new Map<string, Entry<unknown>>();

export const FOREVER = Number.POSITIVE_INFINITY;

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
  store.set(key, { value: Promise.resolve(value), expiresAt: Date.now() + ttlMs });
}

export function invalidate(prefix: string) {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) {
      store.delete(key);
    }
  }
}

export function clearCache() {
  store.clear();
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
