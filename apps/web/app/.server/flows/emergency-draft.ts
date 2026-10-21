import type { Address, Hex } from "viem";
import { governance } from "../governance";
import { latestBlock } from "../rpc";
import { simulateCall } from "../signatures";

// The proposer's check of a draft emergency upgrade: each call as an eth_call from the
// ProtocolUpgradeHandler, which is who executes them, all at one block (the head, named in the
// answer; at "latest" when the head cannot be read). Opt-in: it sends the calls to this app's RPC.

export type DraftCallCheck =
  | { ok: true }
  | { ok: false; error: string }
  /** No answer (an RPC failure, a rate limit, out of gas): never shown as a revert. */
  | { ok: null; skipped: string };

export async function checkDraftCalls(
  calls: readonly { target: Address; value: bigint; data: Hex }[]
): Promise<{ results: DraftCallCheck[]; atBlock: string | null }> {
  const [gov, head] = await Promise.all([governance(), latestBlock().catch(() => null)]);
  const results = await Promise.all(
    calls.map(async (call): Promise<DraftCallCheck> => {
      const simulation = await simulateCall({
        from: gov.upgradeHandler,
        to: call.target,
        data: call.data,
        value: call.value,
        ...(head ? { blockNumber: head.number } : {}),
      });
      switch (simulation.status) {
        case "ok":
          return { ok: true };
        case "reverted":
          return { ok: false, error: simulation.error };
        case "skipped":
          return { ok: null, skipped: simulation.reason };
      }
    })
  );
  return { results, atBlock: head ? head.number.toString() : null };
}
