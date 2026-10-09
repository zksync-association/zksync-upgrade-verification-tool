import { clearCache } from "@/.server/cache";
import { type UpgradeProposal, upgradeProposalId } from "@/common/proposal";
import { type buildTypedData, governanceHashes } from "@/common/typed-data";
import { UPGRADE_STATES } from "@/common/upgrade-states";
import { zeroAddress } from "viem";
import { beforeEach, expect, it, vi } from "vitest";
import { APPROVAL_TX, MAINNET, TRANSACTIONS, UPGRADE_ID } from "../support/fixtures";

const state = vi.hoisted(() => ({
  signatures: Promise.resolve(),
  checks: [] as (bigint | undefined)[],
  verified: 0,
  discovery: Promise.resolve(null) as Promise<null>,
  execution: Promise.resolve() as Promise<void>,
  lookups: [] as string[],
  // What the historical checkSignatures read throws instead of accepting.
  recheck: null as Error | null,
  devNode: true,
  // What the archive-state probe answers (or throws).
  archive: (async () => true) as () => Promise<boolean>,
}));

// The upgrade's start, Security Council approval (block 201, APPROVAL_TX) and execution come
// from the handler's log index.
const PROPOSAL: UpgradeProposal = { calls: [], executor: zeroAddress, salt: UPGRADE_ID };
const ID = upgradeProposalId(PROPOSAL);
vi.mock("@/.server/chain/puh-index", async (original) => ({
  ...(await original<typeof import("@/.server/chain/puh-index")>()),
  puhIndex: () => ({
    single: async (name: string, id: string) => {
      state.lookups.push(name);
      if (name === "UpgradeStarted")
        return {
          args: { _id: id, _proposal: PROPOSAL },
          log: { blockNumber: 100n, transactionHash: APPROVAL_TX },
        };
      if (name === "UpgradeExecuted") await state.execution;
      return { args: { _id: id }, log: { blockNumber: 201n, transactionHash: APPROVAL_TX } };
    },
  }),
}));

vi.mock("@/.server/rpc", () => {
  const l1 = {
    getTransaction: async () => TRANSACTIONS[APPROVAL_TX],
    readContract: async ({ functionName }: { functionName: string }) => {
      if (functionName === "upgradeState") return UPGRADE_STATES.Done;
      if (functionName === "upgradeStatus") return [100, 200, false, false, true];
      throw new Error(`Unexpected ${functionName}`);
    },
  };
  return {
    network: async () => ({ isDevNode: state.devNode }),
    safeBlockNumber: async () => (state.devNode ? -1n : 900n),
    latestBlock: async () => ({ number: 1_000n, hash: `0x${"0b".repeat(32)}` }),
    l1,
    l1State: l1,
  };
});
// The historical checkSignatures is a direct eth_call (chain/call.ts).
vi.mock("@/.server/chain/call", async (original) => ({
  ...(await original<typeof import("@/.server/chain/call")>()),
  callFn: async ({ functionName, blockNumber }: { functionName: string; blockNumber?: bigint }) => {
    if (functionName !== "checkSignatures") throw new Error(`Unexpected ${functionName}`);
    state.checks.push(blockNumber);
    if (state.recheck) throw state.recheck;
  },
}));

vi.mock("@/.server/governance", () => ({
  governance: async () => ({
    network: { isDevNode: true, standardLegalVetoDays: 3 },
    upgradeHandler: MAINNET.upgradeHandler,
    securityCouncil: {
      address: MAINNET.securityCouncil,
      members: [],
      thresholds: { approveUpgrade: 4 },
      domain: {
        name: "SecurityCouncil",
        version: "1",
        chainId: 1,
        verifyingContract: MAINNET.securityCouncil,
      },
    },
    guardians: {
      address: MAINNET.guardians,
      members: [],
      thresholds: { approveUpgrade: 5, extendLegalVeto: 2 },
      domain: { name: "Guardians", version: "1", chainId: 1, verifyingContract: MAINNET.guardians },
    },
  }),
}));

vi.mock("@/.server/logs", async (original) => ({
  ...(await original<typeof import("@/.server/logs")>()),
  findBlockByTimestamp: async () => {
    throw new Error("no timestamp search with the log index");
  },
  getLogs: async () => {
    throw new Error("no log scan with the log index");
  },
}));
vi.mock("@/.server/flows/l2", () => ({ findL2ProposalForUpgrade: async () => state.discovery }));
vi.mock("@/.server/flows/common", async (original) => ({
  ...(await original<typeof import("@/.server/flows/common")>()),
  hasArchiveState: () => state.archive(),
  executionFor: async () => null,
}));
vi.mock("@/.server/signatures", async (original) => ({
  ...(await original<typeof import("@/.server/signatures")>()),
  verifySignatureSet: async (params: {
    typedData: ReturnType<typeof buildTypedData>;
    threshold: number;
  }) => {
    state.verified++;
    await state.signatures;
    return {
      ...params,
      hashes: governanceHashes(params.typedData),
      members: [],
      valid: [],
      thresholdCheck: { status: "below", threshold: params.threshold, valid: 0 },
      safeApiError: null,
    };
  },
}));

const { getStandardUpgradeOverview, loadStandardUpgrade, getStandardUpgrade } = await import(
  "@/.server/flows/standard"
);
let release: () => void;
beforeEach(() => {
  clearCache();
  state.lookups = [];
  state.discovery = Promise.resolve(null);
  state.execution = Promise.resolve();
  state.verified = 0;
  state.checks = [];
  state.recheck = null;
  state.devNode = true;
  state.archive = async () => true;
  state.signatures = new Promise<void>((resolve) => {
    release = resolve;
  });
});

it("shows the core and finishes signature checks while L2 discovery and execution lookup are pending", async () => {
  let releaseL2!: () => void;
  let releaseExecution!: () => void;
  state.discovery = new Promise((resolve) => {
    releaseL2 = () => resolve(null);
  });
  state.execution = new Promise((resolve) => {
    releaseExecution = resolve;
  });
  const loading = await loadStandardUpgrade(ID);
  expect(loading.overview.started.idMatches).toBe(true);
  expect(loading.overview).not.toHaveProperty("l2Proposal");
  release();
  expect(await loading.sets).toHaveLength(3);
  expect(await loading.evidence).toHaveLength(1);
  releaseL2();
  releaseExecution();
  await Promise.all([loading.l2Proposal, loading.execution]);
  // Every event came from the log index (the log scan and timestamp search mocks throw).
  expect(state.lookups.sort()).toEqual([
    "UpgradeApprovedBySecurityCouncil",
    "UpgradeExecuted",
    "UpgradeStarted",
  ]);
});

it("keeps JSON waiting for execution and L2 discovery after signatures finish", async () => {
  let releaseL2!: () => void;
  let releaseExecution!: () => void;
  state.discovery = new Promise((resolve) => {
    releaseL2 = () => resolve(null);
  });
  state.execution = new Promise((resolve) => {
    releaseExecution = resolve;
  });
  let finished = false;
  const full = getStandardUpgrade(ID).then((detail) => {
    finished = true;
    return detail;
  });
  release();
  await vi.waitFor(() => expect(state.verified).toBe(3));
  expect(finished).toBe(false);
  releaseExecution();
  await Promise.resolve();
  expect(finished).toBe(false);
  releaseL2();
  expect((await full).executedTx).toBe(APPROVAL_TX);
});

it("loads proposal data without starting Safe verification", async () => {
  const overview = await getStandardUpgradeOverview(ID);
  expect(overview.state).toBe(UPGRADE_STATES.Done);
  expect(overview.started.idMatches).toBe(true);
  expect(state.verified).toBe(0);
  release();
});

it("re-checks recorded approvals while current signature checks are still pending", async () => {
  const loading = await loadStandardUpgrade(ID);
  let finished = false;
  const full = loading.sets.then(() => {
    finished = true;
  });
  const evidence = await loading.evidence;
  expect(evidence[0]?.state).toMatchObject({ status: "done", txHash: APPROVAL_TX });
  expect(evidence[0]?.used?.signers.length).toBe(6);
  expect(evidence[0]?.historical).toEqual({ block: "200", accepted: true, error: null });
  expect(state.checks).toEqual([200n]);
  expect(finished).toBe(false);
  release();
  await full;
});

it("keeps the JSON engine waiting for verified sets and Safe comparisons", async () => {
  let finished = false;
  const full = getStandardUpgrade(ID).then((detail) => {
    finished = true;
    return detail;
  });
  await vi.waitFor(() => expect(state.verified).toBe(3));
  expect(finished).toBe(false);
  release();
  const detail = await full;
  expect(detail.sets).toHaveLength(3);
  expect(detail.sets[0]?.historical?.accepted).toBe(true);
  expect(detail.sets[0]?.used).toHaveLength(6);
  expect(detail.sets[0]?.used?.every((s) => s.matchesSafe === null)).toBe(true);
});

it("keeps an RPC failure in the historical re-check unknown, and only a revert false", async () => {
  const { CallReverted, UpstreamError } = await import("@/.server/chain/call");
  state.recheck = new UpstreamError("internal error (JSON-RPC error -32603)");
  const failed = await (await loadStandardUpgrade(ID)).evidence;
  expect(failed[0]?.historical).toEqual({
    block: "200",
    accepted: null,
    error: "internal error (JSON-RPC error -32603)",
  });
  // Not kept: the next view asks again.
  state.recheck = new CallReverted("Signature verification failed", "0x", 3);
  const reverted = await (await loadStandardUpgrade(ID)).evidence;
  expect(reverted[0]?.historical).toEqual({
    block: "200",
    accepted: false,
    error: "Signature verification failed",
  });
  expect(state.checks).toEqual([200n, 200n]);
  release();
});

it("keeps a definite re-check at a final block for good, and an RPC failure never", async () => {
  const { UpstreamError } = await import("@/.server/chain/call");
  state.devNode = false;
  state.recheck = new UpstreamError("timed out");
  await (await loadStandardUpgrade(ID)).evidence;
  state.recheck = null;
  expect((await (await loadStandardUpgrade(ID)).evidence)[0]?.historical?.accepted).toBe(true);
  expect((await (await loadStandardUpgrade(ID)).evidence)[0]?.historical?.accepted).toBe(true);
  expect(state.checks).toEqual([200n, 200n]);
  release();
});

it("shows a failed archive-state probe as not re-checked, with the RPC error, and keeps nothing", async () => {
  const { UpstreamError } = await import("@/.server/chain/call");
  state.devNode = false;
  state.archive = async () => {
    throw new UpstreamError("Too Many Requests (JSON-RPC error 429)");
  };
  const failed = await (await loadStandardUpgrade(ID)).evidence;
  expect(failed[0]?.historical).toEqual({
    block: "200",
    accepted: null,
    error: "RPC error: Too Many Requests (JSON-RPC error 429)",
  });
  expect(state.checks).toEqual([]);
  // The next view asks again and re-checks.
  state.archive = async () => true;
  const checked = await (await loadStandardUpgrade(ID)).evidence;
  expect(checked[0]?.historical).toEqual({ block: "200", accepted: true, error: null });
  // A definite "no archive state" is said as such.
  clearCache();
  state.archive = async () => false;
  const none = await (await loadStandardUpgrade(ID)).evidence;
  expect(none[0]?.historical).toEqual({
    block: "200",
    accepted: null,
    error: "RPC has no archive state for this block",
  });
  release();
});
