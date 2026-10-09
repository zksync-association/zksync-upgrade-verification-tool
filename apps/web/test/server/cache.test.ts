import { cacheSize, cached, clearCache, remainingMs, replace } from "@/.server/cache";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

beforeEach(() => {
  clearCache();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

it("shares a slow read beyond its TTL and starts freshness when it resolves", async () => {
  let resolve!: (value: number) => void;
  const compute = vi.fn(
    () =>
      new Promise<number>((done) => {
        resolve = done;
      })
  );
  const first = cached("slow", 100, compute);
  await vi.advanceTimersByTimeAsync(200);
  expect(cached("slow", 100, compute)).toBe(first);
  expect(compute).toHaveBeenCalledTimes(1);
  resolve(7);
  await first;
  await vi.advanceTimersByTimeAsync(99);
  expect(await cached("slow", 100, compute)).toBe(7);
  await vi.advanceTimersByTimeAsync(2);
  expect(cached("slow", 100, compute)).not.toBe(first);
});

it("never restores an invalidated in-flight result after settings change", async () => {
  let resolve!: (value: number) => void;
  const old = cached(
    "source",
    1000,
    () =>
      new Promise<number>((done) => {
        resolve = done;
      })
  );
  clearCache();
  const fresh = cached("source", 1000, async () => 2);
  resolve(1);
  await old;
  expect(await cached("source", 1000, async () => 3)).toBe(await fresh);
});

it("retries rejected reads and disables caching for zero TTL", async () => {
  await expect(
    cached("failure", 1000, async () => {
      throw new Error("offline");
    })
  ).rejects.toThrow("offline");
  expect(await cached("failure", 1000, async () => 4)).toBe(4);
  let count = 0;
  expect(await cached("fork", 0, async () => ++count)).toBe(1);
  expect(await cached("fork", 0, async () => ++count)).toBe(2);
});

it("keeps a result only for the TTL it reports once it arrives", async () => {
  const { cachedUntil } = await import("@/.server/cache");
  let resolve!: (value: { value: number; ttlMs: number }) => void;
  const compute = vi.fn(
    () =>
      new Promise<{ value: number; ttlMs: number }>((done) => {
        resolve = done;
      })
  );
  // Concurrent callers share the read in flight, whatever its TTL turns out to be.
  const first = cachedUntil("fact", compute);
  expect(cachedUntil("fact", compute)).toBe(first);
  resolve({ value: 1, ttlMs: 0 });
  expect(await first).toBe(1);
  // A TTL of 0 (e.g. above the finality boundary) keeps nothing.
  const second = cachedUntil("fact", compute);
  expect(compute).toHaveBeenCalledTimes(2);
  resolve({ value: 2, ttlMs: Number.POSITIVE_INFINITY });
  expect(await second).toBe(2);
  await vi.advanceTimersByTimeAsync(10 ** 9);
  expect(await cachedUntil("fact", compute)).toBe(2);
  expect(compute).toHaveBeenCalledTimes(2);

  await expect(
    cachedUntil("broken", async () => {
      throw new Error("offline");
    })
  ).rejects.toThrow("offline");
  expect(await cachedUntil("broken", async () => ({ value: 3, ttlMs: 1000 }))).toBe(3);
});

it("seeds a known value without waiting on, joining or replacing a live entry", async () => {
  const { cachedUntil, seed } = await import("@/.server/cache");
  let reject!: (error: Error) => void;
  const inFlight = cachedUntil(
    "start",
    () =>
      new Promise<{ value: number; ttlMs: number }>((_, fail) => {
        reject = fail;
      })
  );
  // Another caller's read is in flight: the seed leaves it alone and returns at once.
  seed("start", 5, Number.POSITIVE_INFINITY);
  expect(cachedUntil("start", async () => ({ value: 9, ttlMs: 1000 }))).toBe(inFlight);
  reject(new Error("still backfilling"));
  await expect(inFlight).rejects.toThrow("still backfilling");
  // Once that read is gone, the seed takes and later reads use it.
  seed("start", 5, Number.POSITIVE_INFINITY);
  const compute = vi.fn(async () => ({ value: 9, ttlMs: 1000 }));
  expect(await cachedUntil("start", compute)).toBe(5);
  expect(compute).not.toHaveBeenCalled();
  // A live value is never replaced; a TTL <= 0 stores nothing.
  seed("start", 6, Number.POSITIVE_INFINITY);
  expect(await cachedUntil("start", compute)).toBe(5);
  seed("nothing", 1, 0);
  expect(await cachedUntil("nothing", compute)).toBe(9);
});

it("replaces an entry, resolved or in flight, with a value read ahead of requests", async () => {
  let resolve!: (value: number) => void;
  const inFlight = cached(
    "head",
    4_000,
    () =>
      new Promise<number>((done) => {
        resolve = done;
      })
  );
  // In flight: served until it answers.
  expect(remainingMs("head")).toBe(Number.POSITIVE_INFINITY);
  replace("head", 2, 4_000);
  const compute = vi.fn(async () => 9);
  expect(await cached("head", 4_000, compute)).toBe(2);
  // Callers already waiting keep their own read's answer, which is not stored.
  resolve(1);
  expect(await inFlight).toBe(1);
  expect(await cached("head", 4_000, compute)).toBe(2);
  expect(compute).not.toHaveBeenCalled();
  expect(remainingMs("head")).toBe(4_000);
  await vi.advanceTimersByTimeAsync(1_000);
  expect(remainingMs("head")).toBe(3_000);
  // A replacement restarts the lifetime.
  replace("head", 3, 4_000);
  expect(remainingMs("head")).toBe(4_000);
  await vi.advanceTimersByTimeAsync(4_000);
  expect(remainingMs("head")).toBeNull();
  expect(await cached("head", 4_000, compute)).toBe(9);
  replace("nothing", 1, 0);
  expect(remainingMs("nothing")).toBeNull();
});

it("drops expired entries now and then, so per-block keys do not pile up", async () => {
  for (let block = 0; block < 1_000; block++)
    await cached(`status:${block}`, 1_000, async () => block);
  const forever = cached("final", Number.POSITIVE_INFINITY, async () => "kept");
  await forever;
  const pending = cached("slow", 1_000, () => new Promise<number>(() => {}));
  expect(cacheSize()).toBe(1_002);
  await vi.advanceTimersByTimeAsync(61_000);
  // The next write sweeps: only the entry for good and the read in flight are left.
  await cached("next", 1_000, async () => 0);
  expect(cacheSize()).toBe(3);
  expect(cached("final", Number.POSITIVE_INFINITY, async () => "again")).toBe(forever);
  expect(cached("slow", 1_000, async () => 1)).toBe(pending);
});
