import { type buildTypedData, governanceHashes } from "@/common/typed-data";
import { UPGRADE_STATES } from "@/common/upgrade-states";
import { beforeEach, expect, it, vi } from "vitest";
import { APPROVAL_TX, MAINNET, TRANSACTIONS, UPGRADE_ID } from "../support/fixtures";

const state = vi.hoisted(() => ({
  signatures: Promise.resolve(),
  checks: [] as (bigint | undefined)[],
  verified: 0,
  discovery: Promise.resolve(null) as Promise<null>,
  execution: Promise.resolve() as Promise<void>,
}));

vi.mock("@/.server/rpc", () => ({
  network: async () => ({ isDevNode: true }),
  l1: {
    getTransaction: async () => TRANSACTIONS[APPROVAL_TX],
    readContract: async ({
      functionName,
      blockNumber,
    }: { functionName: string; blockNumber?: bigint }) => {
      if (functionName === "upgradeState") return UPGRADE_STATES.Done;
      if (functionName === "upgradeStatus") return [100, 200, false, false, true];
      if (functionName === "checkSignatures") {
        state.checks.push(blockNumber);
        return;
      }
      throw new Error(`Unexpected ${functionName}`);
    },
  },
  latestBlock: async () => ({ number: 1_000n }),
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

vi.mock("@/.server/cache", () => ({
  cached: async (key: string, _ttl: number, compute: () => Promise<unknown>) =>
    key.startsWith("started:")
      ? {
          id: UPGRADE_ID,
          idMatches: true,
          txHash: APPROVAL_TX,
          blockNumber: "100",
          proposal: {
            calls: [],
            salt: UPGRADE_ID,
            executor: "0x0000000000000000000000000000000000000000",
          },
        }
      : compute(),
}));
vi.mock("@/.server/logs", () => ({ findBlockByTimestamp: async () => 200n }));
vi.mock("@/.server/flows/l2", () => ({ findL2ProposalForUpgrade: async () => state.discovery }));
vi.mock("@/.server/flows/common", async (original) => ({
  ...(await original<typeof import("@/.server/flows/common")>()),
  eventsWithId: async (_address: unknown, _abi: unknown, name: string) => {
    if (name === "UpgradeExecuted") await state.execution;
    return [{ log: { transactionHash: APPROVAL_TX, blockNumber: 201n } }];
  },
  hasArchiveState: async () => true,
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
  state.discovery = Promise.resolve(null);
  state.execution = Promise.resolve();
  state.verified = 0;
  state.checks = [];
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
  const loading = await loadStandardUpgrade(UPGRADE_ID);
  expect(loading.overview.started.idMatches).toBe(true);
  expect(loading.overview).not.toHaveProperty("l2Proposal");
  release();
  expect(await loading.sets).toHaveLength(3);
  expect(await loading.evidence).toHaveLength(1);
  releaseL2();
  releaseExecution();
  await Promise.all([loading.l2Proposal, loading.execution]);
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
  const full = getStandardUpgrade(UPGRADE_ID).then((detail) => {
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
  const overview = await getStandardUpgradeOverview(UPGRADE_ID);
  expect(overview.state).toBe(UPGRADE_STATES.Done);
  expect(overview.started.idMatches).toBe(true);
  expect(state.verified).toBe(0);
  release();
});

it("re-checks recorded approvals while current signature checks are still pending", async () => {
  const loading = await loadStandardUpgrade(UPGRADE_ID);
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
  const full = getStandardUpgrade(UPGRADE_ID).then((detail) => {
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
