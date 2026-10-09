import { cached, clearCache } from "@/.server/cache";
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
