import { clearCache } from "@/.server/cache";
import { l2GovernorAbi } from "@/common/abis";
import {
  type Address,
  ContractFunctionExecutionError,
  ContractFunctionRevertedError,
  type Hex,
  HttpRequestError,
  type PublicClient,
  encodeAbiParameters,
  encodeEventTopics,
  getAbiItem,
  keccak256,
  toHex,
} from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SECRET_URL } from "../support/fake-calls";

// A Guardians veto page reads the L2 proposal it cancels from ZKsync Era. "Not found" is an
// answer about the governor; an L2 read that failed must never read as one (nor close the veto):
// the detail says the proposal could not be read, and why, without the RPC URL.

const TOKEN_GOVERNOR: Address = "0x0000000000000000000000000000000000000a01";
const GUARDIANS: Address = "0x0000000000000000000000000000000000000a02";
const SIGNER: Address = "0x0000000000000000000000000000000000000d01";

function proposalOf(description: string) {
  const content = {
    targets: ["0x0000000000000000000000000000000000000b01"] as Address[],
    values: [0n],
    calldatas: ["0x1234"] as Hex[],
    description,
  };
  const id = BigInt(
    keccak256(
      encodeAbiParameters(
        [{ type: "address[]" }, { type: "uint256[]" }, { type: "bytes[]" }, { type: "bytes32" }],
        [content.targets, content.values, content.calldatas, keccak256(toHex(description))]
      )
    )
  );
  const created = getAbiItem({ abi: l2GovernorAbi, name: "ProposalCreated" });
  const log = {
    address: TOKEN_GOVERNOR,
    topics: encodeEventTopics({ abi: l2GovernorAbi, eventName: "ProposalCreated" }),
    data: encodeAbiParameters(created.inputs, [
      id,
      "0x0000000000000000000000000000000000000c01",
      content.targets,
      content.values,
      [""],
      content.calldatas,
      100n,
      200n,
      description,
    ]),
    transactionHash: `0x${"ab".repeat(32)}`,
  };
  return { id, log };
}

const vetoed = proposalOf("Raise the limit");
const other = proposalOf("Something else");

const state = vi.hoisted(() => ({
  l2Configured: true,
  // Governor.state(id) for the vetoed proposal, and for any other one: a value or an error.
  l2State: 1 as number | Error,
  otherState: 1 as number | Error,
  // Governor.proposalSnapshot(id): 0 when the governor has no such proposal.
  snapshot: 150n as bigint | Error,
  logs: [] as unknown[],
}));

vi.mock("@/.server/logs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/.server/logs")>()),
  findBlockByTimestamp: async () => 1n,
  getLogs: async () => state.logs,
}));

const answer = (value: unknown) => {
  if (value instanceof Error) throw value;
  return value;
};
const client = {
  getBlock: async () => ({ number: 1_000n, timestamp: 10_000_000n }),
  readContract: async ({ functionName, args }: { functionName: string; args?: unknown[] }) => {
    if (functionName === "proposalSnapshot") return answer(state.snapshot);
    if (functionName === "votingDelay") return 50n;
    if (functionName === "state")
      return answer(args?.[0] === vetoed.id ? state.l2State : state.otherState);
    throw new Error(`unexpected ${functionName}`);
  },
} as unknown as PublicClient;

vi.mock("@/.server/rpc", () => ({
  network: async () => ({
    chainId: 1,
    isDevNode: false,
    l2RpcUrl: state.l2Configured ? SECRET_URL : null,
    l2Governors: { token: TOKEN_GOVERNOR, govOps: null, protocol: null },
  }),
  l2: async () => (state.l2Configured ? client : null),
  l1: { readContract: async () => vetoed.id },
}));

const gov = {
  guardians: {
    address: GUARDIANS,
    nonce: "0",
    members: [SIGNER],
    thresholds: { cancelL2Proposal: 1 },
    domain: { name: "Guardians", version: "1", chainId: 1, verifyingContract: GUARDIANS },
  },
};
vi.mock("@/.server/governance", () => ({ governance: async () => gov }));
vi.mock("@/.server/signatures", () => ({
  verifySignatureSet: async () => ({
    thresholdCheck: { status: "met" },
    valid: [{ signer: SIGNER, signature: "0xaa" }],
    members: [],
  }),
  simulate: async () => ({ status: "ok" }),
}));
vi.mock("@/.server/flows/messages", () => ({
  collectMessages: async () => ({ groups: [], errors: [], anomalies: 0 }),
}));

const { getL2Veto, listL2Vetoes } = await import("@/.server/flows/l2-veto");

const params = {
  l2ProposalId: vetoed.id.toString(),
  l2GovernorAddress: TOKEN_GOVERNOR,
  l2GasLimit: "1000000",
  l2GasPerPubdataByteLimit: "800",
  refundRecipient: GUARDIANS,
  txMintValue: "0",
  nonce: "0",
};

/** What viem's readContract throws when the node answers -32603 (or code 3: viem cannot tell). */
const internalError = () =>
  new ContractFunctionExecutionError(
    new ContractFunctionRevertedError({
      abi: l2GovernorAbi,
      functionName: "state",
      message: "internal error",
    }),
    {
      abi: l2GovernorAbi,
      functionName: "state",
      args: [vetoed.id],
      contractAddress: TOKEN_GOVERNOR,
    }
  );

beforeEach(() => {
  clearCache();
  state.l2Configured = true;
  state.l2State = 1;
  state.otherState = 1;
  state.snapshot = 150n;
  state.logs = [vetoed.log];
});

describe("getL2Veto", () => {
  it("reads an Active proposal, checks its id, and builds the execution", async () => {
    const detail = await getL2Veto(params);
    expect(detail.l2Proposal).toMatchObject({ state: "Active", idMatchesLocal: true });
    expect(detail.l2Error).toBeNull();
    expect(detail.state).toEqual({ status: "open" });
    expect(detail.execution?.to).toBe(GUARDIANS);
  });

  it("reports a proposal the governor does not have as not found, which is an answer", async () => {
    state.snapshot = 0n;
    const detail = await getL2Veto(params);
    expect(detail.l2Proposal).toBeNull();
    expect(detail.l2Error).toBeNull();
  });

  it.each([
    [
      "state() fails with -32603",
      () => {
        state.l2State = internalError();
      },
    ],
    [
      "proposalSnapshot() fails",
      () => {
        state.snapshot = internalError();
      },
    ],
    [
      "the L2 RPC is down",
      () => {
        state.l2State = new HttpRequestError({ url: SECRET_URL, status: 503 });
      },
    ],
  ])("never reads as not found when %s", async (_name, fail) => {
    fail();
    const detail = await getL2Veto(params);
    expect(detail.l2Proposal).toBeNull();
    expect(detail.l2Error).toEqual(expect.any(String));
    expect(detail.l2Error).not.toBe("");
    // A failed read neither closes the veto nor builds an execution without the content.
    expect(detail.state).toEqual({ status: "open" });
    expect(detail.execution).toBeNull();
    expect(JSON.stringify(detail)).not.toContain("secret-host");
  });

  it("keeps the RPC URL and its key out of the error", async () => {
    state.l2State = new TypeError(`fetch failed: getaddrinfo ENOTFOUND ${SECRET_URL}`);
    const { l2Error } = await getL2Veto(params);
    expect(l2Error).toContain("fetch failed");
    expect(l2Error).not.toContain("secret-host");
    expect(l2Error).not.toContain("0123456789abcdef");
  });

  it("says no ZKsync Era RPC is configured instead of not found", async () => {
    state.l2Configured = false;
    const detail = await getL2Veto(params);
    expect(detail.l2Proposal).toBeNull();
    expect(detail.l2Error).toMatch(/No ZKsync Era RPC/);
  });

  it("is not failed by another proposal's state read", async () => {
    state.logs = [other.log, vetoed.log];
    state.otherState = internalError();
    const detail = await getL2Veto(params);
    expect(detail.l2Proposal).toMatchObject({ proposalId: vetoed.id.toString(), state: "Active" });
    expect(detail.l2Error).toBeNull();
  });
});

describe("listL2Vetoes", () => {
  it("reports a failed vetoable list without the RPC URL", async () => {
    state.l2State = new TypeError(`fetch failed: getaddrinfo ENOTFOUND ${SECRET_URL}`);
    const result = await listL2Vetoes();
    expect(result.vetoable).toEqual([]);
    expect(result.l2Error).toContain("fetch failed");
    expect(result.l2Error).not.toContain("secret-host");
  });
});
