import { clearCache } from "@/.server/cache";
import { ERC1271_MAGIC_VALUE } from "@/common/abis";
import { type buildTypedData, governanceHashes } from "@/common/typed-data";
import { UPGRADE_STATES } from "@/common/upgrade-states";
import { beforeEach, expect, it, vi } from "vitest";
import {
  EMERGENCY_ID,
  EMERGENCY_TX,
  MAINNET,
  TRANSACTIONS,
  UPGRADE_ID,
  messagesFor,
} from "../support/fixtures";
import type { Collected } from "@/.server/flows/messages";

const state = vi.hoisted(() => ({
  signatures: Promise.resolve() as Promise<void>,
  current: 6,
  checks: [] as { address: string; args: string[]; blockNumber: bigint }[],
  scans: vi.fn(),
  verified: 0,
  history: Promise.resolve() as Promise<void>,
  messages: Promise.resolve({ groups: [], errors: [], anomalies: 0 }) as Promise<Collected>,
  discovery: vi.fn(),
}));
const boardDomain = {
  name: "EmergencyUpgradeBoard",
  version: "1",
  chainId: 1,
  verifyingContract: MAINNET.emergencyUpgradeBoard,
};

vi.mock("@/.server/governance", () => ({
  governance: async () => ({
    network: { isDevNode: true },
    upgradeHandler: MAINNET.upgradeHandler,
    securityCouncil: { address: MAINNET.securityCouncil, members: [], eip1271Threshold: 5 },
    guardians: { address: MAINNET.guardians, members: [], eip1271Threshold: 5 },
    emergencyUpgradeBoard: {
      address: MAINNET.emergencyUpgradeBoard,
      zkFoundation: MAINNET.zkFoundation,
      domain: boardDomain,
    },
  }),
}));
vi.mock("@/.server/rpc", () => ({
  network: async () => ({
    isDevNode: true,
    upgradeHandler: MAINNET.upgradeHandler,
    upgradeHandlerDeployBlock: 21_788_382n,
  }),
  latestBlock: async () => ({ number: 26_128_706n, timestamp: 1_791_154_800n }),
  l1: {
    getTransaction: async () => TRANSACTIONS[EMERGENCY_TX],
    readContract: async (params: {
      functionName: string;
      args: string[];
      address: string;
      blockNumber: bigint;
    }) => {
      if (params.functionName === "upgradeState") return state.current;
      if (params.functionName === "upgradeStatus")
        return [0, 0, false, false, params.args[0] === EMERGENCY_ID];
      if (params.functionName === "isValidSignature") {
        state.checks.push(params);
        return ERC1271_MAGIC_VALUE;
      }
      throw new Error(`Unexpected ${params.functionName}`);
    },
  },
}));
vi.mock("@/.server/flows/emergency-event", () => ({
  findEmergencyEvent: async (id: string) => {
    state.discovery(id);
    return { id, txHash: EMERGENCY_TX, blockNumber: 25_766_164n };
  },
}));
vi.mock("@/.server/flows/common", async (original) => ({
  ...(await original<typeof import("@/.server/flows/common")>()),
  hasArchiveState: async () => true,
}));
vi.mock("@/.server/flows/messages", () => ({ collectMessages: async () => state.messages }));
vi.mock("@/.server/logs", () => ({
  findBlockByTimestamp: async () => 26_078_306n,
  getLogs: async (_client: unknown, filter: unknown, from: bigint, to: bigint) => {
    state.scans(filter, from, to);
    await state.history;
    return [];
  },
}));
vi.mock("@/.server/signatures", async (original) => ({
  ...(await original<typeof import("@/.server/signatures")>()),
  verifySignatureSet: async (params: {
    action: string;
    typedData: ReturnType<typeof buildTypedData>;
    threshold: number;
  }) => {
    state.verified++;
    await state.signatures;
    const members = messagesFor(params.action, EMERGENCY_ID).map((message) => ({
      member: message.safe,
      source: "safe",
      signature: message.preparedSignature,
    }));
    return {
      ...params,
      hashes: governanceHashes(params.typedData),
      members,
      valid: [],
      thresholdCheck: { status: "below", threshold: params.threshold, valid: 0 },
      safeApiError: null,
    };
  },
}));

const { getEmergencyUpgrade, loadEmergencyUpgrade, loadEmergencyList, listEmergencyUpgrades } =
  await import("@/.server/flows/emergency");
let release!: () => void;
beforeEach(() => {
  clearCache();
  state.current = UPGRADE_STATES.Done;
  state.checks = [];
  state.verified = 0;
  state.discovery.mockClear();
  state.scans.mockClear();
  state.history = Promise.resolve();
  state.messages = Promise.resolve({ groups: [], errors: [], anomalies: 0 });
  state.signatures = new Promise((resolve) => {
    release = resolve;
  });
});

it("rebuilds calls and verifies original signatures before current Safe checks finish", async () => {
  const loading = await loadEmergencyUpgrade(EMERGENCY_ID);
  expect(loading.overview.state).toBe(UPGRADE_STATES.Done);
  let complete = false;
  const full = loading.detail.then(() => {
    complete = true;
  });
  const execution = await loading.executed;
  expect(execution).toMatchObject({ txHash: EMERGENCY_TX, idMatches: true });
  expect(execution?.historical?.checks.every((c) => c.accepted === true)).toBe(true);
  expect(state.checks).toHaveLength(3);
  expect(state.checks.every((c) => c.blockNumber === 25_766_163n)).toBe(true);
  const actions = [
    "ExecuteEmergencyUpgradeSecurityCouncil",
    "ExecuteEmergencyUpgradeGuardians",
    "ExecuteEmergencyUpgradeZKFoundation",
  ];
  expect(state.checks.map((c) => c.args[0])).toEqual(
    actions.map(
      (action) =>
        governanceHashes(
          messagesFor(action, EMERGENCY_ID)[0]?.message as ReturnType<typeof buildTypedData>
        ).digest
    )
  );
  expect(complete).toBe(false);
  release();
  await full;
});

it("keeps JSON waiting for Safe comparisons and preserves the completed response", async () => {
  let complete = false;
  const full = getEmergencyUpgrade(EMERGENCY_ID).then((d) => {
    complete = true;
    return d;
  });
  await vi.waitFor(() => expect(state.checks).toHaveLength(3));
  expect(complete).toBe(false);
  release();
  const detail = await full;
  expect(detail.executed?.idMatches).toBe(true);
  expect(detail.roles).toHaveLength(3);
  for (const role of detail.roles) {
    expect(role.used?.length).toBeGreaterThan(0);
    expect(role.used?.every((used) => used.matchesSafe === true)).toBe(true);
  }
});

it("makes pending payload review available without execution lookup or Safe completion", async () => {
  state.current = UPGRADE_STATES.None;
  const loading = await loadEmergencyUpgrade(UPGRADE_ID);
  expect(loading.overview).toMatchObject({ id: UPGRADE_ID, state: UPGRADE_STATES.None });
  expect(await loading.executed).toBeNull();
  expect(state.discovery).not.toHaveBeenCalled();
  release();
  expect((await loading.detail).executed).toBeNull();
});

it("classifies pending IDs from current state without waiting for execution history", async () => {
  const { buildTypedData } = await import("@/common/typed-data");
  state.messages = Promise.resolve({
    groups: [EMERGENCY_ID, UPGRADE_ID].map((id) => ({
      digest: id,
      typedData: buildTypedData("ExecuteEmergencyUpgradeSecurityCouncil", boardDomain, { id }),
      reportedSigners: [MAINNET.securityCouncil],
      firstSeen: "2026-10-01",
      lastSeen: "2026-10-01",
    })),
    errors: ["One Safe unavailable"],
    anomalies: 2,
  });
  let releaseHistory!: () => void;
  state.history = new Promise((resolve) => {
    releaseHistory = resolve;
  });
  const loading = await loadEmergencyList();
  const pending = await loading.pending;
  expect(pending.pending.map((p) => p.id)).toEqual([UPGRADE_ID]);
  expect(pending.errors).toEqual(["One Safe unavailable"]);
  expect(pending.anomalies).toBe(2);
  await vi.waitFor(() => expect(state.scans).toHaveBeenCalledTimes(1));
  expect(state.scans.mock.calls[0]?.slice(1)).toEqual([26_078_306n, 26_128_706n]);
  releaseHistory();
  await loading.executed;
  release();
});

it("retains deployment-to-head history for the JSON list", async () => {
  await listEmergencyUpgrades();
  expect(state.scans.mock.calls[0]?.slice(1)).toEqual([21_788_382n, 26_128_706n]);
  release();
});
