import { clearCache } from "@/.server/cache";
import { l2GovernorAbi } from "@/common/abis";
import {
  type Address,
  type Hex,
  InternalRpcError,
  type PublicClient,
  RpcRequestError,
  encodeAbiParameters,
  encodeEventTopics,
  getAbiItem,
  keccak256,
  toHex,
} from "viem";
import { beforeEach, expect, it, vi } from "vitest";

// The L2 proposals Guardians can veto: a proposal whose state() read fails must not silently drop
// out of the vetoable list (nor close its veto); the list fails instead.

const TOKEN_GOVERNOR: Address = "0x0000000000000000000000000000000000000a01";
const GUARDIANS: Address = "0x0000000000000000000000000000000000000a02";

const proposal = {
  targets: ["0x0000000000000000000000000000000000000b01"] as Address[],
  values: [0n],
  calldatas: ["0x1234"] as Hex[],
  description: "Raise the limit",
};
const proposalId = BigInt(
  keccak256(
    encodeAbiParameters(
      [{ type: "address[]" }, { type: "uint256[]" }, { type: "bytes[]" }, { type: "bytes32" }],
      [
        proposal.targets,
        proposal.values,
        proposal.calldatas,
        keccak256(toHex(proposal.description)),
      ]
    )
  )
);

const state = vi.hoisted(() => ({
  // What Governor.state(id) answers: a ProposalState number, or an error to throw.
  l2State: 1 as number | Error,
}));

const created = getAbiItem({ abi: l2GovernorAbi, name: "ProposalCreated" });
const log = {
  address: "0x0000000000000000000000000000000000000a01",
  topics: encodeEventTopics({ abi: l2GovernorAbi, eventName: "ProposalCreated" }),
  data: encodeAbiParameters(created.inputs, [
    proposalId,
    "0x0000000000000000000000000000000000000c01",
    proposal.targets,
    proposal.values,
    [""],
    proposal.calldatas,
    100n,
    200n,
    proposal.description,
  ]),
  transactionHash: `0x${"ab".repeat(32)}`,
};

vi.mock("@/.server/logs", () => ({
  findBlockByTimestamp: async () => 1n,
  getLogs: async (_client: unknown, filter: { address: string }) =>
    filter.address === TOKEN_GOVERNOR ? [log] : [],
}));

const client = {
  getBlock: async () => ({ number: 1_000n, timestamp: 10_000_000n }),
  readContract: async ({ functionName }: { functionName: string }) => {
    if (functionName !== "state") throw new Error(`unexpected ${functionName}`);
    if (state.l2State instanceof Error) throw state.l2State;
    return state.l2State;
  },
} as unknown as PublicClient;

vi.mock("@/.server/rpc", () => ({
  network: async () => ({
    chainId: 1,
    isDevNode: false,
    l2Governors: { token: TOKEN_GOVERNOR, govOps: null, protocol: null },
  }),
  l2: async () => client,
  l1: { readContract: async () => proposalId },
}));
vi.mock("@/.server/governance", () => ({
  governance: async () => ({ guardians: { address: GUARDIANS } }),
}));

const { activeL2Proposals } = await import("@/.server/flows/l2");

beforeEach(() => {
  clearCache();
  state.l2State = 1;
});

it("lists an Active proposal with its checked id", async () => {
  const [listed, ...rest] = await activeL2Proposals();
  expect(rest).toEqual([]);
  expect(listed).toMatchObject({
    proposalId: proposalId.toString(),
    state: "Active",
    idMatchesLocal: true,
    idMatchesContract: true,
  });
});

it("drops a proposal only for a state it can no longer be vetoed in", async () => {
  state.l2State = 7; // Executed
  expect(await activeL2Proposals()).toEqual([]);
});

it.each([
  [
    "an internal error (-32603)",
    () =>
      new InternalRpcError(
        new RpcRequestError({
          body: {},
          error: { code: -32603, message: "internal error" },
          url: "http://l2",
        })
      ),
  ],
  ["a network failure", () => new Error("fetch failed")],
])("fails the list when the state read fails with %s", async (_name, error) => {
  state.l2State = error();
  await expect(activeL2Proposals()).rejects.toThrow();
});
