import { l1MessengerEventAbi, l2GovernorAbi, upgradeHandlerAbi } from "@/common/abis";
import { upgradeProposalId } from "@/common/proposal";
import { clearCache } from "@/.server/cache";
import { findL2ProposalInBatch, upgradeBatch, L1_MESSENGER } from "@/.server/flows/l2-batch";
import { findL2ProposalForUpgrade } from "@/.server/flows/l2";
import {
  type PublicClient,
  type Hex,
  encodeFunctionData,
  encodeAbiParameters,
  encodeEventTopics,
} from "viem";
import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  logs: [] as unknown[],
  receipt: {} as unknown,
  unsupported: false,
  input: "0x" as Hex,
  request: vi.fn(),
  scans: vi.fn(),
}));
const governor = "0x0000000000000000000000000000000000000001" as const;
const handler = "0x0000000000000000000000000000000000000002" as const;
const txHash = `0x${"ab".repeat(32)}` as Hex;
const proposal = { calls: [], executor: governor, salt: `0x${"cd".repeat(32)}` as Hex };
const id = upgradeProposalId(proposal);
vi.mock("@/.server/logs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/.server/logs")>()),
  findBlockByTimestamp: async () => 100n,
  getLogs: async (_client: unknown, filter: { address: string }, from: bigint, to: bigint) => {
    state.scans(filter, from, to);
    return filter.address === L1_MESSENGER
      ? state.logs
      : (state.receipt as { logs: unknown[] }).logs
          .filter((l: any) => l.address === governor)
          .map((l: any) => ({ ...l, transactionHash: txHash }));
  },
}));
const client = {
  request: async (r: unknown) => {
    state.request(r);
    if (state.unsupported) throw new Error("method unavailable");
    return ["0x64", "0x65"];
  },
  getTransactionReceipt: async () => state.receipt,
  getBlock: async () => ({ number: 1000n, timestamp: 100000n }),
} as unknown as PublicClient;
vi.mock("@/.server/rpc", () => ({
  network: async () => ({
    isDevNode: true,
    upgradeHandler: handler,
    l2Governors: { protocol: governor },
  }),
  l2: async () => client,
  l1: { getTransaction: async () => ({ to: handler, input: state.input }) },
}));
function messageLog(body: Hex = "0x1234") {
  return {
    address: L1_MESSENGER,
    transactionHash: txHash,
    topics: encodeEventTopics({
      abi: l1MessengerEventAbi,
      eventName: "L1MessageSent",
      args: { _sender: governor, _hash: id },
    }),
    data: encodeAbiParameters([{ type: "bytes" }], [body]),
  };
}
beforeEach(async () => {
  clearCache();
  state.unsupported = false;
  state.request.mockClear();
  state.scans.mockClear();
  state.input = encodeFunctionData({
    abi: upgradeHandlerAbi,
    functionName: "startUpgrade",
    args: [12n, 0n, 0, [], proposal],
  });
  const { encodeUpgradeProposal } = await import("@/common/proposal");
  const message = messageLog(encodeUpgradeProposal(proposal));
  state.logs = [message];
  state.receipt = {
    status: "success",
    blockNumber: 100n,
    logs: [
      message,
      {
        address: governor,
        topics: encodeEventTopics({ abi: l2GovernorAbi, eventName: "ProposalExecuted" }),
        data: encodeAbiParameters([{ type: "uint256" }], [42n]),
      },
    ],
  };
});
it("uses only a startUpgrade batch whose proposal recomputes to the requested id", () => {
  expect(upgradeBatch(state.input, id)).toBe(12);
  expect(upgradeBatch(state.input, txHash)).toBeNull();
  expect(upgradeBatch("0x", id)).toBeNull();
  expect(
    upgradeBatch(
      encodeFunctionData({
        abi: upgradeHandlerAbi,
        functionName: "startUpgrade",
        args: [0n, 0n, 0, [], proposal],
      }),
      id
    )
  ).toBeNull();
});
it("finds the matching message and governor execution within the exact batch", async () => {
  expect(await findL2ProposalInBatch(client, id, governor, 12)).toEqual({
    governor,
    proposalId: "42",
    executedTx: txHash,
  });
  expect(state.request).toHaveBeenCalledWith({ method: "zks_getL1BatchBlockRange", params: [12] });
  expect(state.scans.mock.calls[0]?.slice(1)).toEqual([100n, 101n]);
  expect(state.scans.mock.calls[0]?.[0].topics[2]).toBe(id);
});
it("rejects a matching indexed hash with a different message body", async () => {
  state.logs = [messageLog()];
  expect(await findL2ProposalInBatch(client, id, governor, 12)).toBeNull();
});
it("rejects a receipt outside the batch and a different executing governor", async () => {
  (state.receipt as any).blockNumber = 102n;
  expect(await findL2ProposalInBatch(client, id, governor, 12)).toBeNull();
  (state.receipt as any).blockNumber = 100n;
  expect(await findL2ProposalInBatch(client, id, handler, 12)).toBeNull();
});
it("uses the previous discovery path when the batch RPC is unsupported", async () => {
  state.unsupported = true;
  expect(await findL2ProposalForUpgrade(id, 1000, { startedTxHash: txHash })).toEqual({
    governor,
    proposalId: "42",
    executedTx: txHash,
    title: null,
  });
  expect(state.scans.mock.calls.some(([filter]) => filter.address === governor)).toBe(true);
});

it("falls back when the exact batch contains no matching message", async () => {
  state.logs = [];
  expect(await findL2ProposalForUpgrade(id, 1000, { startedTxHash: txHash })).toEqual({
    governor,
    proposalId: "42",
    executedTx: txHash,
    title: null,
  });
  expect(state.scans.mock.calls.some(([filter]) => filter.address === governor)).toBe(true);
});

it("does not trust batch metadata from a start call for another proposal", async () => {
  state.input = encodeFunctionData({
    abi: upgradeHandlerAbi,
    functionName: "startUpgrade",
    args: [12n, 0n, 0, [], { ...proposal, salt: txHash }],
  });
  expect(await findL2ProposalForUpgrade(id, 1000, { startedTxHash: txHash })).toEqual({
    governor,
    proposalId: "42",
    executedTx: txHash,
    title: null,
  });
  expect(state.request).not.toHaveBeenCalled();
});
