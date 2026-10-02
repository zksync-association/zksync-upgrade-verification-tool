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
  const now = Date.now();
  const hit = store.get(key) as Entry<T> | undefined;
  if (hit && hit.expiresAt > now) {
    return hit.value;
  }

  const value = compute();
  store.set(key, { value, expiresAt: now + ttlMs });
  value.catch(() => {
    if (store.get(key)?.value === value) {
      store.delete(key);
    }
  });
  return value;
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
