import { clearCache } from "@/.server/cache";
import { IndexIncomplete, IndexUnavailable } from "@/.server/chain/log-index";
import { IndexIntegrityError } from "@/.server/chain/puh-index";
import { findEmergencyEvent } from "@/.server/flows/emergency-event";
import { EMERGENCY_ID, EMERGENCY_TX, MAINNET } from "../support/fixtures";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  transition: 25_766_164n,
  archive: true,
  devNode: true,
  safe: 26_128_642n,
  scans: vi.fn(),
  reads: vi.fn(),
  logs: [] as unknown[],
  logError: false,
  // What the log index answers for EmergencyUpgradeExecuted(id).
  index: vi.fn(),
  refreshHead: vi.fn(),
}));
vi.mock("@/.server/rpc", () => ({
  network: async () => ({
    isDevNode: state.devNode,
    upgradeHandler: MAINNET.upgradeHandler,
    upgradeHandlerDeployBlock: 21_788_382n,
  }),
  safeBlockNumber: async () => state.safe,
  refreshHead: state.refreshHead,
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
vi.mock("@/.server/logs", async (original) => ({
  ...(await original<typeof import("@/.server/logs")>()),
  getLogs: async (_client: unknown, filter: unknown, from: bigint, to: bigint) => {
    state.scans(filter, from, to);
    if (state.logError) throw new Error("history unavailable");
    return state.logs;
  },
}));
vi.mock("@/.server/chain/puh-index", async (original) => ({
  ...(await original<typeof import("@/.server/chain/puh-index")>()),
  puhIndex: () => ({ single: state.index }),
}));

const unavailable = () => new IndexUnavailable("logs disabled", 21_788_382n, 26_128_642n);

beforeEach(() => {
  clearCache();
  state.transition = 25_766_164n;
  state.archive = true;
  state.devNode = true;
  state.safe = 26_128_642n;
  state.logError = false;
  state.logs = [{ transactionHash: EMERGENCY_TX, blockNumber: state.transition }];
  state.scans.mockClear();
  state.reads.mockClear();
  state.index.mockReset();
  state.index.mockRejectedValue(unavailable());
  state.refreshHead.mockClear();
});

describe("with the log index", () => {
  // `final`: the index answered from its final range (here: at or below the boundary).
  const hit = (blockNumber = 25_766_164n, final = blockNumber <= state.safe) => ({
    args: { _id: EMERGENCY_ID },
    log: { transactionHash: EMERGENCY_TX, blockNumber },
    final,
  });

  it("answers from the index without archive reads or log scans", async () => {
    state.index.mockResolvedValue(hit());
    expect(await findEmergencyEvent(EMERGENCY_ID)).toEqual({
      id: EMERGENCY_ID,
      txHash: EMERGENCY_TX,
      blockNumber: 25_766_164n,
    });
    expect(state.index).toHaveBeenCalledWith("EmergencyUpgradeExecuted", EMERGENCY_ID);
    expect(state.reads).not.toHaveBeenCalled();
    expect(state.scans).not.toHaveBeenCalled();
  });

  it("returns null when the complete index has no emergency execution (e.g. a standard upgrade)", async () => {
    state.index.mockResolvedValue(null);
    expect(await findEmergencyEvent(EMERGENCY_ID)).toBeNull();
    // Asked twice: at the cached head, then at the newest head.
    expect(state.index).toHaveBeenCalledTimes(2);
    expect(state.refreshHead).toHaveBeenCalledTimes(1);
    expect(state.reads).not.toHaveBeenCalled();
    expect(state.scans).not.toHaveBeenCalled();
  });

  it("asks again at the newest head before answering null (the state is read at 'latest')", async () => {
    state.devNode = false;
    // The cached head predates the execution block; the newest head has it.
    state.index.mockResolvedValueOnce(null);
    state.index.mockImplementationOnce(async () => {
      expect(state.refreshHead).toHaveBeenCalledTimes(1);
      return hit(state.safe + 70n);
    });
    expect(await findEmergencyEvent(EMERGENCY_ID)).toEqual({
      id: EMERGENCY_ID,
      txHash: EMERGENCY_TX,
      blockNumber: state.safe + 70n,
    });
    expect(state.reads).not.toHaveBeenCalled();
    expect(state.scans).not.toHaveBeenCalled();
  });

  it("reports two executions for one id instead of falling back", async () => {
    state.index.mockRejectedValue(new IndexIntegrityError("2 EmergencyUpgradeExecuted events"));
    await expect(findEmergencyEvent(EMERGENCY_ID)).rejects.toBeInstanceOf(IndexIntegrityError);
    expect(state.reads).not.toHaveBeenCalled();
  });

  it("reports a live index that is still backfilling; a dev node falls back", async () => {
    state.devNode = false;
    state.index.mockRejectedValue(new IndexIncomplete("ProtocolUpgradeHandler", 1n, 2n));
    await expect(findEmergencyEvent(EMERGENCY_ID)).rejects.toBeInstanceOf(IndexIncomplete);
    expect(state.reads).not.toHaveBeenCalled();

    state.devNode = true;
    expect((await findEmergencyEvent(EMERGENCY_ID))?.txHash).toBe(EMERGENCY_TX);
    expect(state.reads).toHaveBeenCalled();
  });

  it("keeps a final execution for good and reads a newer one again", async () => {
    state.devNode = false;
    state.index.mockResolvedValue(hit());
    await findEmergencyEvent(EMERGENCY_ID);
    await findEmergencyEvent(EMERGENCY_ID);
    expect(state.index).toHaveBeenCalledTimes(1);

    clearCache();
    state.index.mockClear();
    state.index.mockResolvedValue(hit(state.safe + 1n));
    await findEmergencyEvent(EMERGENCY_ID);
    await findEmergencyEvent(EMERGENCY_ID);
    expect(state.index).toHaveBeenCalledTimes(2);

    // Not found is never kept: the execution may land in the next block.
    clearCache();
    state.index.mockClear();
    state.index.mockResolvedValue(null);
    await findEmergencyEvent(EMERGENCY_ID);
    await findEmergencyEvent(EMERGENCY_ID);
    // Each lookup asks at the cached head and once more at the newest head.
    expect(state.index).toHaveBeenCalledTimes(4);
  });

  it("never keeps an execution the index answered from its tail, even below the boundary now", async () => {
    state.devNode = false;
    // Read from the unfinalized tail; the boundary has since moved past its block.
    state.index.mockResolvedValue(hit(state.safe - 10n, false));
    await findEmergencyEvent(EMERGENCY_ID);
    await findEmergencyEvent(EMERGENCY_ID);
    expect(state.index).toHaveBeenCalledTimes(2);
  });
});

describe("when the log index is unavailable", () => {
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
});
