import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { until } from "../support/live-world";
import { endTestSteps, parkedSteps } from "../support/test-end";

// The guard of test/support/test-end.ts: a test that times out inside a fake-time loop runs on
// after vitest moved to the next test. Each `it.fails` below times out on purpose (so it passes);
// the test after it checks that the timed-out body ran nothing more, and moved nothing of its own.

const realSetTimeout = globalThis.setTimeout;
/** Real time, in which a body that was not stopped would go on stepping the fake clock. */
const realWait = (ms: number) => new Promise<void>((resolve) => realSetTimeout(resolve, ms));

const leak = { steps: 0, stop: false };

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_800_000_000_000);
});

afterEach(async () => {
  await endTestSteps();
  vi.useRealTimers();
});

/** The checks of the test after a timed-out one (`stop` ends a body the guard did not stop). */
async function nothingRanOn(parkedBefore: number) {
  const steps = leak.steps;
  const start = Date.now();
  await realWait(300);
  leak.stop = true;
  expect(Date.now()).toBe(start);
  expect(leak.steps).toBe(steps);
  expect(parkedSteps()).toBe(parkedBefore + 1);
  leak.stop = false;
}

describe("a test that times out inside a fake-time loop", () => {
  let parked = 0;
  it.fails(
    "runs blocks until it times out (on purpose)",
    async () => {
      parked = parkedSteps();
      while (!leak.stop) {
        await vi.advanceTimersByTimeAsync(12_000);
        leak.steps++;
      }
    },
    200
  );

  it("stops at the step it was in: it moves the next test's fake clock no further, and runs nothing after", async () => {
    await nothingRanOn(parked);
  });
});

describe("a test that times out inside a helper's loop (live-world's until)", () => {
  let parked = 0;
  it.fails(
    "waits for something that never comes until it times out (on purpose)",
    async () => {
      parked = parkedSteps();
      await until(() => leak.stop, Number.POSITIVE_INFINITY);
      leak.steps++;
    },
    200
  );

  it("stops there too", async () => {
    await nothingRanOn(parked);
  });
});

describe("a test that ends normally", () => {
  it("parks nothing: a step begun after the end of the test before goes on as usual", async () => {
    const parked = parkedSteps();
    await endTestSteps();
    const start = Date.now();
    await vi.advanceTimersByTimeAsync(12_000);
    expect(Date.now()).toBe(start + 12_000);
    expect(parkedSteps()).toBe(parked);
  });
});
