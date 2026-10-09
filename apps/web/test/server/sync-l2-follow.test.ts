import type { BlockRef, PolledHead } from "@/.server/rpc";
import { type Hex, zeroHash } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// /api/vetoes stays answered from memory while it is being viewed: ZKsync Era's head is served for
// 4 s, so the engine reads Era again every 3 s between L1 blocks (not only once per 12 s L1 tick),
// for as long as the vetoable proposals were viewed lately and someone is using the app; while
// idle it does not read Era at all. refreshVetoableL2 (l2-index.test.ts covers what it reads)
// stands in here, answering whether the proposals were viewed lately.

const state = vi.hoisted(() => ({ viewedLately: true, refreshes: [] as number[] }));
vi.mock("@/.server/flows/l2", () => ({
  refreshVetoableL2: vi.fn(async () => {
    state.refreshes.push(Date.now());
    return state.viewedLately;
  }),
}));

const { SyncEngine, liveSteps, stopSync } = await import("@/.server/sync/engine");

const NOW = 1_800_000_000_000;

/** A node whose head stays at one block (seen 1 s after its timestamp). */
function pollHead(): Promise<PolledHead> {
  const head: BlockRef = {
    number: 100n,
    hash: `0x${"ab".repeat(32)}` as Hex,
    parentHash: zeroHash,
    timestamp: BigInt(Math.floor(NOW / 1000)) - 1n,
  };
  return Promise.resolve({
    head,
    finalized: undefined,
    generation: 1,
    answeredAt: Date.now(),
    boundary: async () => 20n,
    isNewest: () => true,
    publish: () => true,
    confirm: () => true,
  });
}

function engine(options: { mode?: "always" | "window"; keepWarmMs?: number } = {}) {
  return new SyncEngine({
    mode: options.mode ?? "always",
    keepWarmMs: options.keepWarmMs ?? 600_000,
    generation: 1,
    currentGeneration: () => 1,
    network: async () => ({ isDevNode: false, name: "mainnet", blockTimeSeconds: 12 }),
    pollHead,
    // Only the Era step: the others need the live chain modules.
    steps: liveSteps().filter((step) => step.name === "l2"),
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  state.viewedLately = true;
  state.refreshes = [];
});

afterEach(() => {
  stopSync();
  vi.useRealTimers();
});

describe("ZKsync Era between L1 blocks", () => {
  it("is read every 3 s while the vetoable proposals are viewed, and no longer once they are not", async () => {
    const e = engine({ keepWarmMs: 120_000 });
    e.touch();
    await vi.advanceTimersByTimeAsync(30_000);
    // The tick's read, then one every 3 s: Era's head (served 4 s) never runs out.
    expect(state.refreshes[0]).toBe(NOW);
    const gaps = state.refreshes.slice(1).map((at, i) => at - (state.refreshes[i] as number));
    expect(gaps.length).toBeGreaterThanOrEqual(9);
    for (const gap of gaps) expect(gap).toBe(3_000);

    // Nobody looked at them for 10 minutes: the loop stops at its next read.
    state.viewedLately = false;
    await vi.advanceTimersByTimeAsync(3_000);
    const stopped = state.refreshes.length;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(state.refreshes).toHaveLength(stopped);
    e.stop();
  });

  it("stops when nobody uses the app, and is not read at all while idle", async () => {
    const e = engine({ keepWarmMs: 10_000 });
    e.touch();
    await vi.advanceTimersByTimeAsync(9_000);
    const inUse = state.refreshes.length;
    expect(inUse).toBeGreaterThanOrEqual(3);
    // Past SYNC_KEEPWARM_MS: idle.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(state.refreshes.length).toBeLessThanOrEqual(inUse + 1);
    const idle = state.refreshes.length;
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(state.refreshes).toHaveLength(idle);
    expect(e.status()).toMatchObject({ active: true, cost: { mode: "idle" } });
    e.stop();
  });

  it("stops with the engine", async () => {
    const e = engine();
    e.touch();
    await vi.advanceTimersByTimeAsync(7_000);
    e.stop();
    const at = state.refreshes.length;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(state.refreshes.length).toBeLessThanOrEqual(at + 1);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(state.refreshes.length).toBeLessThanOrEqual(at + 1);
  });
});
