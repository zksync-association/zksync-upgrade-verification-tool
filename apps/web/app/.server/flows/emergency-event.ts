import { upgradeHandlerAbi } from "@/common/abis";
import type { Hex } from "viem";
import { defaultLogger } from "@config/log.server";
import { cached } from "../cache";
import { getLogs } from "../logs";
import { l1, network, safeBlockNumber } from "../rpc";
import { topicOf } from "./common";
import { firstExecutedBlock } from "./execution-block";

export type EmergencyEvent = { id: Hex; txHash: Hex; blockNumber: bigint };

/** State narrows discovery; the indexed event, never the flag alone, establishes an emergency. */
export async function findEmergencyEvent(id: Hex): Promise<EmergencyEvent | null> {
  const net = await network();
  return cached(`emergency-event:${id.toLowerCase()}`, net.isDevNode ? 0 : 60_000, async () => {
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
  });
}
