import type { BlockRef, PolledHead } from "@/.server/rpc";
import { type Hex, zeroHash } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A page showing ZKsync Era (the vetoable proposals, a veto, the upgrades that can start) stays
// answered from memory while it is on screen: ZKsync Era's head is served for 4 s, so the engine
// reads Era again every 3 s between L1 blocks (not only once per 12 s L1 tick), for as long as
// such a page is on screen and someone is using the app; otherwise it does not read Era at all.
// refreshVetoableL2 (l2-index.test.ts covers what it reads) stands in here.

const state = vi.hoisted(() => ({ refreshes: [] as number[], moving: false }));
vi.mock("@/.server/flows/l2", () => ({
  refreshVetoableL2: vi.fn(async () => {
    state.refreshes.push(Date.now());
    return true;
  }),
}));

const { SyncEngine, liveSteps, stopSync } = await import("@/.server/sync/engine");
const { presence, resetPresence } = await import("@/.server/sync/presence");

/** A visible tab shows these keys (a beat). */
const show = (...keys: string[]) =>
  presence().beat({
    tab: "tab-under-test",
    reason: "interval",
    items: keys.map((key) => ({ key, rev: null })),
  });

const NOW = 1_800_000_000_000;

/**
 * A node whose head stays at one block (seen 1 s after its timestamp), or with `state.moving` one
 * with a new block every 12 s.
 */
function pollHead(): Promise<PolledHead> {
  const blocks = state.moving ? BigInt(Math.floor((Date.now() - NOW) / 12_000)) : 0n;
  const head: BlockRef = {
    number: 100n + blocks,
    hash: `0x${(100n + blocks).toString(16).padStart(64, "a")}` as Hex,
    parentHash: zeroHash,
    timestamp: BigInt(Math.floor(NOW / 1000)) - 1n + blocks * 12n,
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
  resetPresence({ keepWarmMs: options.keepWarmMs ?? 600_000 });
  return new SyncEngine({
    mode: options.mode ?? "always",
    inUse: () => presence().inUse(),
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
  state.refreshes = [];
  state.moving = false;
});

afterEach(() => {
  stopSync();
  resetPresence();
  vi.useRealTimers();
});

describe("ZKsync Era between L1 blocks", () => {
  it("is read every 3 s while an Era page is on screen, and no longer once it is not", async () => {
    const e = engine({ keepWarmMs: 120_000 });
    show("status", "list:vetoes");
    e.resume();
    await vi.advanceTimersByTimeAsync(30_000);
    // The tick's read, then one every 3 s: Era's head (served 4 s) never runs out.
    expect(state.refreshes[0]).toBe(NOW);
    const gaps = state.refreshes.slice(1).map((at, i) => at - (state.refreshes[i] as number));
    expect(gaps.length).toBeGreaterThanOrEqual(9);
    for (const gap of gaps) expect(gap).toBe(3_000);

    // The tab navigates to a page without Era: the loop stops at its next read, with no grace.
    show("status", "list:upgrades");
    await vi.advanceTimersByTimeAsync(3_000);
    const stopped = state.refreshes.length;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(state.refreshes).toHaveLength(stopped);
    e.stop();
  });

  it("is never read without an Era page on screen, a page of every other kind included", async () => {
    state.moving = true;
    const e = engine({ keepWarmMs: 600_000 });
    show("status", "upgrade:0xab", "list:upgrades", "list:emergency", "tx:0xcd");
    e.resume();
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(state.refreshes).toEqual([]);
    // A veto page (l2:…) or the startable upgrades count as Era pages.
    for (const key of ["l2:0x1:7", "list:startable"]) {
      show("status", key);
      const before = state.refreshes.length;
      await vi.advanceTimersByTimeAsync(15_000);
      expect(state.refreshes.length).toBeGreaterThan(before);
    }
    e.stop();
  });

  it("stops when nobody uses the app, and is not read at all while idle", async () => {
    const e = engine({ keepWarmMs: 10_000 });
    show("list:vetoes");
    e.resume();
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
    show("list:vetoes");
    e.resume();
    await vi.advanceTimersByTimeAsync(7_000);
    e.stop();
    const at = state.refreshes.length;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(state.refreshes.length).toBeLessThanOrEqual(at + 1);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(state.refreshes.length).toBeLessThanOrEqual(at + 1);
  });
});
