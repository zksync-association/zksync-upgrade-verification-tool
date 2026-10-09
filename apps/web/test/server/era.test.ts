import type { L2Head } from "@/.server/rpc";
import { type Hex, zeroHash } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The ZKsync Era timer (sync/era.ts): while a page showing Era is on screen (a veto's L2 proposal,
// the vetoable list, the upgrades that can start) and someone uses the app, Era is read once a
// minute ('finalized' every 32 reads), and at each on-screen proposal's voteStart/voteEnd, timed
// from Era's own block timestamps; never otherwise. What a read does at Era's head (the index
// tail, the states) is l2-index.test.ts's; here it is a stand-in that records each pass.

const NOW = 1_800_000_000_000;

const state = vi.hoisted(() => ({
  /** Era's clock minus the local one (s): the local clock may be off by this much. */
  skew: 0,
  /** Era's blocks stop advancing (a lagging Era). */
  stalled: null as number | null,
  heads: [] as { at: number; withFinalized: boolean }[],
  passes: [] as { at: number; keys: string[] }[],
  proposals: [] as {
    governor: string;
    proposalId: string;
    state: string;
    voteStart: string;
    voteEnd: string;
  }[],
  last: null as unknown,
  active: true,
  keys: new Set<string>(),
  /** How long Era takes to answer a head read (ms). */
  rttMs: 0,
}));

/** Era's head now: a block a second, timestamped by Era's clock (the local clock plus `skew`). */
function eraHead(): L2Head {
  const local = state.stalled ?? Date.now();
  const timestamp = BigInt(Math.floor(local / 1000) + state.skew);
  const number = 70_000_000n + (timestamp - BigInt(Math.floor(NOW / 1000)));
  return {
    head: {
      number,
      hash: `0x${number.toString(16).padStart(64, "e")}` as Hex,
      parentHash: zeroHash,
      timestamp,
    },
    safe: number - 100n,
    answeredAt: Date.now(),
  };
}

vi.mock("@/.server/rpc", () => ({
  l2: async () => ({}),
  network: async () => ({}),
  rpcGeneration: () => 1,
  refreshL2ChainHead: async ({ withFinalized = true }: { withFinalized?: boolean } = {}) => {
    state.heads.push({ at: Date.now(), withFinalized });
    if (state.rttMs > 0) await new Promise((resolve) => setTimeout(resolve, state.rttMs));
    state.last = eraHead();
    return state.last;
  },
  lastL2Head: () => state.last,
}));
vi.mock("@/.server/chain/l2-index", () => ({ isIndexedL2Governor: () => true }));
vi.mock("@/.server/flows/l2", () => ({
  knownGovernors: async () => [{ kind: "token", name: "ZkTokenGovernor", address: "0x1" }],
}));
vi.mock("@/.server/sync/content-engine", () => ({
  noteEraContent: async (keys: Iterable<string>) => {
    state.passes.push({ at: Date.now(), keys: [...keys] });
    return { proposals: state.proposals, noted: 1 };
  },
}));

const { ERA_EVERY_MS, eraWatchStatus, startEraWatch, stopEraWatch } = await import(
  "@/.server/sync/era"
);

const driver = {
  active: () => state.active,
  keys: () => state.keys as ReadonlySet<string>,
};

/** What the engine does at every beat and tick: (re)starts the timer, which starts what is due. */
const wake = () => startEraWatch(driver);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  state.skew = 0;
  state.stalled = null;
  state.heads = [];
  state.passes = [];
  state.proposals = [];
  state.last = null;
  state.active = true;
  state.keys = new Set();
  state.rttMs = 0;
});

afterEach(() => {
  stopEraWatch();
  vi.useRealTimers();
});

describe("the Era timer", () => {
  it("reads Era at once when an Era page comes on screen, then once a minute while it is", async () => {
    state.keys = new Set(["status", "list:vetoes"]);
    wake();
    await vi.advanceTimersByTimeAsync(10 * 60_000 + 100);
    expect(state.passes[0]?.at).toBe(NOW);
    expect(state.passes.map((p) => p.at - NOW)).toEqual(
      Array.from({ length: 11 }, (_, i) => i * ERA_EVERY_MS)
    );
    // Only the Era keys go to the pass.
    expect(state.passes[0]?.keys).toEqual(["list:vetoes"]);
    // Every engine wake meanwhile changes nothing: one timer.
    for (let i = 0; i < 5; i++) wake();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(state.passes).toHaveLength(11);
    expect(eraWatchStatus()).toMatchObject({ onScreen: 1, boundaries: 0 });
  });

  it("C-4: at most one head read a minute ('finalized' every 32), and none once no Era page is on screen", async () => {
    state.keys = new Set(["l2:0x1:7"]);
    wake();
    await vi.advanceTimersByTimeAsync(40 * 60_000);
    expect(state.heads).toHaveLength(41);
    expect(state.heads.filter((h) => h.withFinalized).map((h) => (h.at - NOW) / 60_000)).toEqual([
      0, 32,
    ]);
    // The tab moves to a page without Era: the timer's next minute finds none, and stops.
    state.keys = new Set(["status", "upgrade:0xab", "list:upgrades", "tx:0xcd"]);
    await vi.advanceTimersByTimeAsync(60_000);
    const stopped = state.heads.length;
    for (let i = 0; i < 10; i++) wake();
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    expect(state.heads).toHaveLength(stopped);
    // An Era page again: read at once (the last read is over a minute old).
    state.keys = new Set(["list:startable"]);
    wake();
    await vi.advanceTimersByTimeAsync(100);
    expect(state.heads).toHaveLength(stopped + 1);
  });

  it("reads nothing while nobody uses the app, and stops when use ends", async () => {
    state.keys = new Set(["list:vetoes"]);
    state.active = false;
    wake();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(state.heads).toEqual([]);
    state.active = true;
    wake();
    await vi.advanceTimersByTimeAsync(2 * 60_000 + 100);
    expect(state.heads).toHaveLength(3);
    state.active = false;
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(state.heads).toHaveLength(3);
  });

  it("stops for good with the engine", async () => {
    state.keys = new Set(["list:vetoes"]);
    wake();
    await vi.advanceTimersByTimeAsync(100);
    stopEraWatch();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(state.heads).toHaveLength(1);
  });
});

describe("S-27: boundary timers", () => {
  for (const skew of [0, 60, -60]) {
    it(`fire one second past a proposal's voteEnd by Era's timestamps, the local clock ${skew === 0 ? "right" : `off by ${skew} s`}`, async () => {
      state.skew = skew;
      const t0 = BigInt(Math.floor(NOW / 1000) + skew);
      // Active, voting ends 30 s after the Era head the first read sees.
      state.proposals = [
        {
          governor: "0x1",
          proposalId: "7",
          state: "Active",
          voteStart: (t0 - 100n).toString(),
          voteEnd: (t0 + 30n).toString(),
        },
      ];
      state.keys = new Set(["l2:0x1:7"]);
      wake();
      await vi.advanceTimersByTimeAsync(100);
      expect(state.passes).toHaveLength(1);
      expect(eraWatchStatus().boundaries).toBe(1);
      // The state changes with the block after voteEnd: once Era is read again, it is Defeated.
      state.proposals = [
        { ...(state.proposals[0] as (typeof state.proposals)[0]), state: "Defeated" },
      ];
      await vi.advanceTimersByTimeAsync(31_000);
      // A read 31 s after the first (by the time since Era answered, not the local clock).
      expect(state.passes.map((p) => p.at - NOW)).toEqual([0, 31_000]);
      expect(eraWatchStatus().boundaries).toBe(0);
      // Then the minute timer as before.
      await vi.advanceTimersByTimeAsync(30_000);
      expect(state.passes.map((p) => p.at - NOW)).toEqual([0, 31_000, 60_000]);
    });
  }

  it("is armed again 2 s later while Era's head is not past the boundary yet, and from voteStart for a pending proposal", async () => {
    const t0 = BigInt(Math.floor(NOW / 1000));
    state.proposals = [
      {
        governor: "0x1",
        proposalId: "8",
        state: "Pending",
        voteStart: (t0 + 10n).toString(),
        voteEnd: (t0 + 1_000n).toString(),
      },
    ];
    state.keys = new Set(["list:vetoes"]);
    wake();
    await vi.advanceTimersByTimeAsync(100);
    // Era stalls: its head stays at the first read's block.
    state.stalled = NOW;
    await vi.advanceTimersByTimeAsync(11_000);
    expect(state.passes.map((p) => p.at - NOW)).toEqual([0, 11_000]);
    await vi.advanceTimersByTimeAsync(4_000);
    // Re-read every 2 s while Era's head is not past voteStart.
    expect(state.passes.map((p) => p.at - NOW)).toEqual([0, 11_000, 13_000, 15_000]);
    // Era moves again (its head passes voteStart): no further boundary read.
    state.stalled = null;
    state.proposals = [];
    await vi.advanceTimersByTimeAsync(2_000);
    const after = state.passes.length;
    await vi.advanceTimersByTimeAsync(20_000);
    expect(state.passes).toHaveLength(after);
  });

  it("an Era that stalls just before a boundary: one timer per proposal, at most 30 retries 2 s apart, then only the minute timer", async () => {
    // Era answers in 200 ms (a read's own pass re-arms boundaries while the timer's waits).
    state.rttMs = 200;
    const t0 = BigInt(Math.floor(NOW / 1000));
    state.proposals = [
      {
        governor: "0x1",
        proposalId: "8",
        state: "Pending",
        voteStart: (t0 + 1n).toString(),
        voteEnd: (t0 + 100_000n).toString(),
      },
    ];
    state.keys = new Set(["list:vetoes"]);
    wake();
    await vi.advanceTimersByTimeAsync(300);
    // Era stops producing blocks a second before voteStart.
    state.stalled = NOW;
    const perMinute: number[] = [];
    for (let minute = 0; minute < 5; minute++) {
      const before = state.heads.length;
      for (let second = 0; second < 60; second++) {
        await vi.advanceTimersByTimeAsync(1_000);
        expect(eraWatchStatus().boundaries).toBeLessThanOrEqual(1);
      }
      perMinute.push(state.heads.length - before);
    }
    // The boundary's first read and its 30 retries, and the minute reads.
    expect(perMinute.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(1 + 30 + 5);
    expect(perMinute.slice(2)).toEqual([1, 1, 1]);
    expect(eraWatchStatus().boundaries).toBe(0);
  });

  it("never fires once no Era page is on screen", async () => {
    const t0 = BigInt(Math.floor(NOW / 1000));
    state.proposals = [
      {
        governor: "0x1",
        proposalId: "9",
        state: "Active",
        voteStart: (t0 - 10n).toString(),
        voteEnd: (t0 + 20n).toString(),
      },
    ];
    state.keys = new Set(["list:vetoes"]);
    wake();
    await vi.advanceTimersByTimeAsync(100);
    state.keys = new Set(["status"]);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(state.heads).toHaveLength(1);
  });
});
