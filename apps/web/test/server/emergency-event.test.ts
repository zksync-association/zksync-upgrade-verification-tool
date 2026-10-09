import { findEmergencyEvent } from "@/.server/flows/emergency-event";
import { EMERGENCY_ID, EMERGENCY_TX, MAINNET } from "../support/fixtures";
import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  transition: 25_766_164n,
  archive: true,
  scans: vi.fn(),
  reads: vi.fn(),
  logs: [] as unknown[],
  logError: false,
}));
vi.mock("@/.server/rpc", () => ({
  network: async () => ({
    isDevNode: true,
    upgradeHandler: MAINNET.upgradeHandler,
    upgradeHandlerDeployBlock: 21_788_382n,
  }),
  safeBlockNumber: async () => 26_128_642n,
  l1: {
    getBlockNumber: async () => 26_128_706n,
    readContract: async (params: { blockNumber: bigint }) => {
      state.reads(params);
      if (!state.archive && params.blockNumber < 26_128_706n)
        throw new Error("archive unavailable");
      return [0, 0, false, false, params.blockNumber >= state.transition];
    },
  },
}));
vi.mock("@/.server/logs", () => ({
  getLogs: async (_client: unknown, filter: unknown, from: bigint, to: bigint) => {
    state.scans(filter, from, to);
    if (state.logError) throw new Error("history unavailable");
    return state.logs;
  },
}));
beforeEach(() => {
  state.transition = 25_766_164n;
  state.archive = true;
  state.logError = false;
  state.logs = [{ transactionHash: EMERGENCY_TX, blockNumber: state.transition }];
  state.scans.mockClear();
  state.reads.mockClear();
});

it("confirms a known id with a single-block, indexed event query", async () => {
  expect(await findEmergencyEvent(EMERGENCY_ID)).toEqual({
    id: EMERGENCY_ID,
    txHash: EMERGENCY_TX,
    blockNumber: state.transition,
  });
  expect(state.scans).toHaveBeenCalledTimes(1);
  expect(state.scans.mock.calls[0]?.slice(1)).toEqual([state.transition, state.transition]);
  expect(state.scans.mock.calls[0]?.[0]).toMatchObject({
    address: MAINNET.upgradeHandler,
    topics: [expect.any(String), EMERGENCY_ID],
  });
  expect(
    state.reads.mock.calls.every(
      ([p]) => p.functionName === "upgradeStatus" && p.args[0] === EMERGENCY_ID
    )
  ).toBe(true);
});

it("does not scan history for an unexecuted id", async () => {
  state.transition = 30_000_000n;
  expect(await findEmergencyEvent(EMERGENCY_ID)).toBeNull();
  expect(state.reads).toHaveBeenCalledTimes(1);
  expect(state.scans).not.toHaveBeenCalled();
});

it("never treats a completed standard upgrade as an emergency based on its flag", async () => {
  state.logs = [];
  expect(await findEmergencyEvent(EMERGENCY_ID)).toBeNull();
  expect(state.scans).toHaveBeenCalledTimes(1);
});

it("falls back to indexed logs if the RPC cannot serve historical state", async () => {
  state.archive = false;
  expect((await findEmergencyEvent(EMERGENCY_ID))?.txHash).toBe(EMERGENCY_TX);
  expect(state.scans.mock.calls[0]?.slice(1)).toEqual([21_788_382n, 26_128_706n]);
  expect(state.scans.mock.calls[0]?.[0].topics[1]).toBe(EMERGENCY_ID);
});

it("keeps fallback failure visible instead of returning not found", async () => {
  state.archive = false;
  state.logError = true;
  await expect(findEmergencyEvent(EMERGENCY_ID)).rejects.toThrow("history unavailable");
});

it.each([true, false])("rejects duplicate events (archive=%s)", async (archive) => {
  state.archive = archive;
  state.logs.push(state.logs[0]);
  await expect(findEmergencyEvent(EMERGENCY_ID)).rejects.toThrow("Multiple emergency");
});
