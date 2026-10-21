import { clearCache } from "@/.server/cache";
import { currentUpgradeStatus, upgradeStatusKey } from "@/.server/upgrade-status";
import { UPGRADE_STATES } from "@/common/upgrade-states";
import type { Hex } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

// upgradeState + upgradeStatus of one id: on a live chain read at the head and kept per head
// HASH (the key the sync engine fills ahead of requests); on a dev node read at 'latest' each time.

const ID: Hex = `0x${"77".repeat(32)}`;

const state = vi.hoisted(() => ({
  devNode: false,
  head: { number: 1_000n, hash: `0x${"aa".repeat(32)}` as `0x${string}`, timestamp: 1n },
  reads: [] as { functionName: string; blockNumber: bigint | undefined }[],
  // Errors the next reads throw, in order (then the contract answers).
  failures: [] as Error[],
  executed: false,
}));

vi.mock("@/.server/rpc", () => ({
  network: async () => ({
    chainId: 1,
    upgradeHandler: "0xE30Dca3047B37dc7d88849dE4A4Dc07937ad5Ab3",
    isDevNode: state.devNode,
  }),
  latestBlock: async () => state.head,
  // State reads go through the client for pinned-block state.
  l1State: {
    readContract: async ({
      functionName,
      blockNumber,
    }: { functionName: string; blockNumber?: bigint }) => {
      state.reads.push({ functionName, blockNumber });
      const failure = state.failures.shift();
      if (failure) throw failure;
      if (functionName === "upgradeState")
        return state.executed ? UPGRADE_STATES.Done : UPGRADE_STATES.Waiting;
      return [1_700_000_000, 0, false, false, state.executed];
    },
  },
}));

/** A viem-like error: the node's text sits in a cause's details. */
const rpcError = (details: string) =>
  Object.assign(new Error("RPC Request failed."), {
    cause: Object.assign(new Error("Internal error"), { details }),
  });

beforeEach(() => {
  clearCache();
  vi.useRealTimers();
  state.devNode = false;
  state.head = { number: 1_000n, hash: `0x${"aa".repeat(32)}`, timestamp: 1n };
  state.reads = [];
  state.failures = [];
  state.executed = false;
});

describe("current upgrade status", () => {
  it("is read at the head's block once per head, and again for another head", async () => {
    const [first, second] = await Promise.all([currentUpgradeStatus(ID), currentUpgradeStatus(ID)]);
    expect(first).toEqual({
      state: UPGRADE_STATES.Waiting,
      status: {
        creationTimestamp: 1_700_000_000,
        securityCouncilApprovalTimestamp: 0,
        guardiansApproval: false,
        guardiansExtendedLegalVeto: false,
        executed: false,
      },
    });
    expect(second).toEqual(first);
    expect(state.reads).toEqual([
      { functionName: "upgradeState", blockNumber: 1_000n },
      { functionName: "upgradeStatus", blockNumber: 1_000n },
    ]);
    await currentUpgradeStatus(ID);
    expect(state.reads).toHaveLength(2);

    // The same height with another hash (a reorg) is another entry.
    state.executed = true;
    state.head = { ...state.head, hash: `0x${"bb".repeat(32)}` };
    expect((await currentUpgradeStatus(ID)).state).toBe(UPGRADE_STATES.Done);
    expect(state.reads).toHaveLength(4);
    expect(upgradeStatusKey(1, ID, { hash: `0x${"aa".repeat(32)}` })).not.toBe(
      upgradeStatusKey(1, ID, state.head)
    );
  });

  it("asks once more when the node does not know the head yet (a lagging backend)", async () => {
    vi.useFakeTimers();
    state.failures = [rpcError("header not found"), rpcError("header not found")];
    const reading = currentUpgradeStatus(ID);
    await vi.advanceTimersByTimeAsync(300);
    expect((await reading).state).toBe(UPGRADE_STATES.Waiting);
    expect(state.reads.every((r) => r.blockNumber === 1_000n)).toBe(true);
    expect(state.reads).toHaveLength(4);
  });

  it("fails (and keeps nothing) when the block is still unknown, or on any other error", async () => {
    vi.useFakeTimers();
    state.failures = Array.from({ length: 4 }, () => rpcError("unknown block"));
    const reading = currentUpgradeStatus(ID);
    const failed = expect(reading).rejects.toThrow("RPC Request failed.");
    await vi.advanceTimersByTimeAsync(300);
    await failed;

    // Not about the block: no retry.
    vi.useRealTimers();
    state.reads = [];
    state.failures = [rpcError("internal error"), rpcError("internal error")];
    await expect(currentUpgradeStatus(ID)).rejects.toThrow("RPC Request failed.");
    expect(state.reads).toHaveLength(2);
    // Nothing was kept: the next read asks again and answers.
    expect((await currentUpgradeStatus(ID)).state).toBe(UPGRADE_STATES.Waiting);
  });

  it("reads at 'latest' every time on a dev node", async () => {
    state.devNode = true;
    await currentUpgradeStatus(ID);
    await currentUpgradeStatus(ID);
    expect(state.reads).toHaveLength(4);
    expect(state.reads.every((r) => r.blockNumber === undefined)).toBe(true);
  });
});
