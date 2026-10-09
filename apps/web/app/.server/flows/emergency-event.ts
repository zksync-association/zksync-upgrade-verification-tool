import { upgradeHandlerAbi } from "@/common/abis";
import type { Hex } from "viem";
import { defaultLogger } from "@config/log.server";
import { FOREVER, cachedUntil } from "../cache";
import { getLogs } from "../logs";
import { type Network, l1, network, safeBlockNumber } from "../rpc";
import { topicOf } from "./common";
import { firstExecutedBlock } from "./execution-block";
import { expectedEvent, indexCannotAnswer } from "./indexed";

export type EmergencyEvent = { id: Hex; txHash: Hex; blockNumber: bigint };

/**
 * State narrows discovery; the indexed event, never the flag alone, establishes an emergency.
 * Called once the state says executed, so the index is asked again at the newest head before it
 * answers null. From the handler's log index; the archive bisection only when the index cannot
 * answer. Kept for good once the event is final; null is never kept.
 */
export async function findEmergencyEvent(id: Hex): Promise<EmergencyEvent | null> {
  const net = await network();
  return cachedUntil(`emergency-event:${id.toLowerCase()}`, async () => {
    try {
      const found = await expectedEvent("EmergencyUpgradeExecuted", id);
      if (!found) return { value: null, ttlMs: 0 };
      return {
        value: { id, txHash: found.log.transactionHash, blockNumber: found.log.blockNumber },
        // Final only if the index answered it from its final range, never from its tail.
        ttlMs: !net.isDevNode && found.final ? FOREVER : 0,
      };
    } catch (error) {
      if (!indexCannotAnswer(error, net)) throw error;
    }
    // The boundary is read before the lookup: a block at or below it was final when it was read.
    const safe = await safeBlockNumber();
    const event = await archiveEmergencyEvent(id, net);
    const final = event !== null && !net.isDevNode && event.blockNumber <= safe;
    return { value: event, ttlMs: final ? FOREVER : 0 };
  });
}

/** Without the index: bisect upgradeStatus over archive state, then read that one block's log. */
async function archiveEmergencyEvent(id: Hex, net: Network): Promise<EmergencyEvent | null> {
  const head = await l1.getBlockNumber({ cacheTime: 0 });
  const filter = {
    address: net.upgradeHandler,
    topics: [topicOf(upgradeHandlerAbi, "EmergencyUpgradeExecuted"), id],
  };
  let block: bigint | null;
  try {
    block = await firstExecutedBlock(
      async (blockNumber) => {
        const status = await l1.readContract({
          address: net.upgradeHandler,
          abi: upgradeHandlerAbi,
          functionName: "upgradeStatus",
          args: [id],
          blockNumber,
        });
        return status[4];
      },
      net.upgradeHandlerDeployBlock,
      head
    );
  } catch {
    defaultLogger.info(
      { id },
      "Archive execution lookup unavailable; falling back to indexed emergency logs"
    );
    const logs = await getLogs(l1, filter, net.upgradeHandlerDeployBlock, head);
    if (logs.length > 1) throw new Error("Multiple emergency execution events for one proposal");
    const log = logs[0];
    return log?.transactionHash && log.blockNumber !== null
      ? { id, txHash: log.transactionHash, blockNumber: log.blockNumber }
      : null;
  }
  if (block === null) return null;
  const logs = await getLogs(l1, filter, block, block, { safeHead: await safeBlockNumber() });
  if (logs.length > 1) throw new Error("Multiple emergency execution events for one proposal");
  const log = logs[0];
  // A standard upgrade also sets executed=true; the emergency event is required.
  return log?.transactionHash && log.blockNumber === block
    ? { id, txHash: log.transactionHash, blockNumber: block }
    : null;
}
