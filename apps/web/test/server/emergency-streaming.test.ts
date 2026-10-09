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
  times: vi.fn(),
  verified: 0,
  history: Promise.resolve() as Promise<void>,
  messages: Promise.resolve({ groups: [], errors: [], anomalies: 0 }) as Promise<Collected>,
  discovery: vi.fn(),
  // What the historical isValidSignature reads answer instead of the magic value.
  historical: null as Error | null,
  // Where the execution event is (a reorg can move it), and what the archive probe answers.
  eventBlock: 25_766_164n,
  archive: (async () => true) as () => Promise<boolean>,
}));
// Executed emergency upgrades in the handler's log index: block → id. Blocks are 12 s apart from
// timestamp 1,700,000,000 except one missed slot; the head is HEAD.
const HEAD = { number: 26_128_706n, timestamp: 1_700_000_000n + 26_128_706n * 12n + 12n };
const blockTime = (n: bigint) => 1_700_000_000n + n * 12n + (n > 26_100_000n ? 12n : 0n);
const WEEK = 7n * 24n * 3600n;
const EXECUTED: [bigint, `0x${string}`][] = [
  [21_800_000n, `0x${"e1".repeat(32)}`],
  [25_766_164n, `0x${"e2".repeat(32)}`],
  // Just before and exactly at the 7-day cut.
  [26_078_306n, `0x${"e3".repeat(32)}`],
  [26_078_307n, `0x${"e4".repeat(32)}`],
  [26_128_700n, `0x${"e5".repeat(32)}`],
];
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
vi.mock("@/.server/chain/puh-index", () => ({
  puhIndex: () => ({
    events: async (name: string, query?: { fromBlock?: bigint }) => {
      state.scans(name, query);
      await state.history;
      return EXECUTED.filter(([blockNumber]) => blockNumber >= (query?.fromBlock ?? 0n)).map(
        ([blockNumber, id]) => ({
          args: { _id: id },
          log: { blockNumber, transactionHash: `0x${blockNumber.toString(16).padStart(64, "0")}` },
          final: true,
        })
      );
    },
  }),
}));
vi.mock("@/.server/rpc", () => ({
  network: async () => ({
    isDevNode: false,
    upgradeHandler: MAINNET.upgradeHandler,
    upgradeHandlerDeployBlock: 21_788_382n,
    blockTimeSeconds: 12,
  }),
  latestBlock: async () => HEAD,
  safeBlockNumber: async () => HEAD.number - 64n,
  blockTimestamps: async (numbers: bigint[]) => {
    state.times(numbers);
    return new Map(numbers.map((n) => [n, blockTime(n)]));
  },
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
      throw new Error(`Unexpected ${params.functionName}`);
    },
  },
}));
// The historical EIP-1271 checks are direct eth_calls (chain/call.ts).
vi.mock("@/.server/chain/call", async (original) => ({
  ...(await original<typeof import("@/.server/chain/call")>()),
  callFn: async (params: {
    functionName: string;
    args: string[];
    address: string;
    blockNumber: bigint;
  }) => {
    if (params.functionName !== "isValidSignature")
      throw new Error(`Unexpected ${params.functionName}`);
    state.checks.push(params);
    if (state.historical) throw state.historical;
    return ERC1271_MAGIC_VALUE;
  },
}));
vi.mock("@/.server/flows/emergency-event", () => ({
  findEmergencyEvent: async (id: string) => {
    state.discovery(id);
    return { id, txHash: EMERGENCY_TX, blockNumber: state.eventBlock };
  },
}));
vi.mock("@/.server/flows/common", async (original) => ({
  ...(await original<typeof import("@/.server/flows/common")>()),
  hasArchiveState: () => state.archive(),
}));
vi.mock("@/.server/flows/messages", () => ({ collectMessages: async () => state.messages }));
vi.mock("@/.server/logs", () => ({
  findBlockByTimestamp: async () => {
    throw new Error("no timestamp search with the log index");
  },
  getLogs: async () => {
    throw new Error("no log scan with the log index");
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
  state.historical = null;
  state.eventBlock = 25_766_164n;
  state.archive = async () => true;
  state.verified = 0;
  state.discovery.mockClear();
  state.scans.mockClear();
  state.times.mockClear();
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

it("keeps an RPC failure in a historical check unknown, and only a revert false", async () => {
  const { CallReverted, UpstreamError } = await import("@/.server/chain/call");
  state.historical = new UpstreamError("internal error (JSON-RPC error -32603)");
  const failed = await (await loadEmergencyUpgrade(EMERGENCY_ID)).executed;
  expect(failed?.historical?.checks.map((c) => [c.accepted, c.error])).toEqual(
    Array(3).fill([null, "internal error (JSON-RPC error -32603)"])
  );
  // Not kept: the next view asks again and gets the definite answer.
  state.historical = new CallReverted("GS026", "0x", 3);
  const reverted = await (await loadEmergencyUpgrade(EMERGENCY_ID)).executed;
  expect(reverted?.historical?.checks.map((c) => [c.accepted, c.error])).toEqual(
    Array(3).fill([false, "GS026"])
  );
  expect(state.checks).toHaveLength(6);
  // A definite answer at a final block is kept for good.
  await (await loadEmergencyUpgrade(EMERGENCY_ID)).executed;
  expect(state.checks).toHaveLength(6);
  release();
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
  // Recent index coverage only (twice 7 days of 12 s slots), cut at head − 7 days by timestamp.
  expect(state.scans.mock.calls[0]).toEqual([
    "EmergencyUpgradeExecuted",
    { fromBlock: HEAD.number - (2n * WEEK) / 12n },
  ]);
  releaseHistory();
  const executed = await loading.executed;
  const cutoff = HEAD.timestamp - WEEK;
  expect(blockTime(26_078_306n)).toBeLessThan(cutoff);
  expect(blockTime(26_078_307n)).toBe(cutoff);
  expect(executed.map((e) => e.executed?.blockNumber)).toEqual(["26128700", "26078307"]);
  expect(executed.map((e) => e.id)).toEqual([`0x${"e5".repeat(32)}`, `0x${"e4".repeat(32)}`]);
  // Newest first, one batch of headers.
  expect(state.times).toHaveBeenCalledTimes(1);
  release();
});

it("retains deployment-to-head history for the JSON list", async () => {
  const list = await listEmergencyUpgrades();
  expect(state.scans.mock.calls[0]).toEqual(["EmergencyUpgradeExecuted", undefined]);
  expect(list.executed.map((e) => e.executed?.blockNumber)).toEqual(
    EXECUTED.map(([block]) => block.toString()).reverse()
  );
  // Every execution, without reading a header.
  expect(state.times).not.toHaveBeenCalled();
  release();
});

it("keys the kept checks by the block they ran at: a reorged execution is checked again", async () => {
  // F = head − 64. The execution lands at F + 1, so the checks run at F (final) and are kept.
  const F = HEAD.number - 64n;
  state.eventBlock = F + 1n;
  const first = await (await loadEmergencyUpgrade(EMERGENCY_ID)).executed;
  expect(first?.historical?.block).toBe(F.toString());
  expect(state.checks.map((c) => c.blockNumber)).toEqual([F, F, F]);
  // A reorg moves the same transaction to F + 3: checked at F + 2, never answered from F.
  state.eventBlock = F + 3n;
  const moved = await (await loadEmergencyUpgrade(EMERGENCY_ID)).executed;
  expect(moved?.historical?.block).toBe((F + 2n).toString());
  expect(state.checks.slice(3).map((c) => c.blockNumber)).toEqual([F + 2n, F + 2n, F + 2n]);
  // Above F nothing is kept: asked again. At F the kept answer still stands.
  await (await loadEmergencyUpgrade(EMERGENCY_ID)).executed;
  expect(state.checks).toHaveLength(9);
  state.eventBlock = F + 1n;
  await (await loadEmergencyUpgrade(EMERGENCY_ID)).executed;
  expect(state.checks).toHaveLength(9);
  release();
});

it("shows a failed archive-state probe as checks not done, with the RPC error, and keeps nothing", async () => {
  const { UpstreamError } = await import("@/.server/chain/call");
  state.archive = async () => {
    throw new UpstreamError("internal error (JSON-RPC error -32603)");
  };
  const failed = await (await loadEmergencyUpgrade(EMERGENCY_ID)).executed;
  expect(failed?.historicalUnavailable).toBeNull();
  expect(failed?.historical?.block).toBe("25766163");
  expect(failed?.historical?.checks).toEqual(
    ["Security Council", "Guardians", "ZKsync Foundation"].map((role) => ({
      role,
      accepted: null,
      error: "RPC error: internal error (JSON-RPC error -32603)",
    }))
  );
  expect(state.checks).toHaveLength(0);
  // The next view asks again.
  state.archive = async () => true;
  const checked = await (await loadEmergencyUpgrade(EMERGENCY_ID)).executed;
  expect(checked?.historical?.checks.every((c) => c.accepted === true)).toBe(true);
  // A definite "no archive state" is said as such, with no checks.
  clearCache();
  state.archive = async () => false;
  const none = await (await loadEmergencyUpgrade(EMERGENCY_ID)).executed;
  expect(none).toMatchObject({
    historical: null,
    historicalUnavailable: "RPC has no archive state for the execution block",
  });
  release();
});
