import type { SafeOwnerApprovalPlan } from "@/common/safe-owner-approval";
import type { Hex } from "viem";
import { utils } from "ethers";
import { inspectReceipt } from "../../standalone/tx-sim/tx-sim-core.mjs";
import { matchWalletTransaction } from "../../standalone/tx-sim/tx-sim-contracts.mjs";
import { l1 } from "./rpc";

/** Shares tx-sim's exact-call, wrapper-runtime and canonical-receipt checks. Never broadcasts. */
export async function readSafeOwnerReceipt(
  _plan: Pick<SafeOwnerApprovalPlan, "chainId" | "owner" | "to" | "data" | "value">,
  _hash: Hex
) {
  const row = {
    network: "sepolia",
    chainId: _plan.chainId,
    from: _plan.owner,
    to: _plan.to,
    data: _plan.data,
    valueWei: _plan.value,
  };
  const rpc = (_network: unknown, _method: string, _params: unknown[]) =>
    l1.request({ method: _method, params: _params } as Parameters<typeof l1.request>[0]);
  const checked = await inspectReceipt(row, _hash, rpc, (_row, _tx, _rpc, _block) =>
    matchWalletTransaction(_row, _tx, _rpc, _block, utils)
  );
  return { hash: _hash, status: checked.status as "pending" | "reverted" | "confirmed" };
}
