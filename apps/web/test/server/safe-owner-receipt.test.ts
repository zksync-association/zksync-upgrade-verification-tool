import { beforeEach, expect, it, vi } from "vitest";
import { safeOwnerMessageCall, type SafeOwnerApprovalPlan } from "@/common/safe-owner-approval";
import type { Address, Hex } from "viem";
import fixture from "../fixtures/failed-safe-owner-approval.json";
import runtimes from "../../standalone/tx-sim/fixtures/wallet-code-evidence.json";

// Recorded public transaction with isolated JSON-RPC responses. The production wrapper decoder,
// runtime pins, exact inner calldata comparison and canonical-receipt verifier run unchanged.
const state = vi.hoisted(() => ({
  tx: null as any,
  receipt: null as any,
  blockHash: "",
  code: {} as Record<string, string>,
}));
vi.mock("@/.server/rpc", () => ({
  l1: {
    request: async ({ method, params }: any) => {
      switch (method) {
        case "eth_chainId":
          return "0xaa36a7";
        case "eth_getTransactionByHash":
          return state.tx;
        case "eth_getTransactionReceipt":
          return state.receipt;
        case "eth_getCode":
          return state.code[params[0].toLowerCase()] ?? "0x";
        case "eth_getBlockByNumber":
          return { hash: state.blockHash };
        case "eth_blockNumber":
          return fixture.receipt.blockNumber;
        default:
          throw new Error(`Unexpected read ${method}`);
      }
    },
  },
}));
import { readSafeOwnerReceipt } from "@/.server/safe-owner-receipt";
const safe = "0x134Cf18eC62e2D42c708A8b6E7476bF4d15E9532" as Address;
const owner = "0xeC6A5c568A59C0858ed6680A6862d64aA2DA8D4b" as Address;
const digest = "0x28786367f09a17e0ac05f9025c45cc7a4e2c1e0c876579402522e8b2c6eb337f" as Hex;
const plan: SafeOwnerApprovalPlan = {
  ...safeOwnerMessageCall(safe, owner, digest),
  safe,
  owner,
  digest,
  chainId: 11155111,
  value: "0",
  alreadyApproved: false,
  gasLimit: "1000000",
  checkedAtBlock: "11965237",
};
const hash = fixture.tx.hash as Hex;
beforeEach(() => {
  state.tx = structuredClone(fixture.tx);
  state.receipt = structuredClone(fixture.receipt);
  state.blockHash = fixture.receipt.blockHash;
  state.code = {
    ...runtimes,
    [owner.toLowerCase()]: "0xef010063c0c19a282a1b52b07dd5a65b58948a07dae32b",
  };
});
it("allows a retry after the recorded MetaMask-wrapped approval reverted in a canonical block", async () => {
  expect(await readSafeOwnerReceipt(plan, hash)).toEqual({ hash, status: "reverted" });
});
it("does not make an unmined submission retryable", async () => {
  state.receipt = null;
  expect((await readSafeOwnerReceipt(plan, hash)).status).toBe("pending");
});
it("does not make a reorged receipt retryable", async () => {
  state.blockHash = `0x${"00".repeat(32)}`;
  expect((await readSafeOwnerReceipt(plan, hash)).status).toBe("pending");
});
it("does not classify a successful receipt as a failed attempt", async () => {
  state.receipt.status = "0x1";
  expect((await readSafeOwnerReceipt(plan, hash)).status).toBe("confirmed");
});
it("rejects another member's calldata", async () => {
  await expect(
    readSafeOwnerReceipt({ ...plan, ...safeOwnerMessageCall(owner, owner, digest) }, hash)
  ).rejects.toThrow(/differs/);
});
it("rejects an altered governance digest", async () => {
  await expect(
    readSafeOwnerReceipt(
      { ...plan, ...safeOwnerMessageCall(safe, owner, `0x${"11".repeat(32)}`) },
      hash
    )
  ).rejects.toThrow(/differs/);
});
it("rejects changed wallet wrapper code", async () => {
  state.code[fixture.tx.to] = "0x00";
  await expect(readSafeOwnerReceipt(plan, hash)).rejects.toThrow(/runtime code differs/);
});
it("rejects a receipt for another hash", async () => {
  state.receipt.transactionHash = `0x${"00".repeat(32)}`;
  await expect(readSafeOwnerReceipt(plan, hash)).rejects.toThrow(/hash differs/);
});
