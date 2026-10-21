import { l1MessengerEventAbi, l2GovernorAbi, upgradeHandlerAbi } from "@/common/abis";
import { fromAbi, upgradeProposalId } from "@/common/proposal";
import {
  type Address,
  type Hex,
  type PublicClient,
  decodeFunctionData,
  decodeEventLog,
  isAddressEqual,
  keccak256,
} from "viem";
import { getL1BatchBlockRange } from "viem/zksync";
import { getLogs } from "../logs";
import { topicOf } from "./common";

export const L1_MESSENGER: Address = "0x0000000000000000000000000000000000008008";

export function upgradeBatch(data: Hex, id: Hex): number | null {
  try {
    const decoded = decodeFunctionData({ abi: upgradeHandlerAbi, data });
    if (decoded.functionName !== "startUpgrade") return null;
    if (upgradeProposalId(fromAbi(decoded.args[4])).toLowerCase() !== id.toLowerCase()) return null;
    const batch = decoded.args[0];
    return batch > 0n && batch <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(batch) : null;
  } catch {
    return null;
  }
}

/** Correlate a message and governor execution within the exact batch referenced by L1. */
export async function findL2ProposalInBatch(
  client: PublicClient,
  id: Hex,
  governor: Address,
  batch: number
) {
  const range = await getL1BatchBlockRange(client as Parameters<typeof getL1BatchBlockRange>[0], {
    l1BatchNumber: batch,
  });
  if (!range || !range.every(Number.isSafeInteger) || range[0] < 0 || range[1] < range[0])
    return null;
  const [from, to] = range.map(BigInt) as [bigint, bigint];
  const messages = await getLogs(
    client,
    {
      address: L1_MESSENGER,
      // The sender may be the governor's timelock; bind the governor using its execution event.
      topics: [topicOf(l1MessengerEventAbi, "L1MessageSent"), null, id],
    },
    from,
    to,
    { safeHead: -1n }
  );
  for (const message of messages) {
    const decoded = decodeEventLog({
      abi: l1MessengerEventAbi,
      eventName: "L1MessageSent",
      data: message.data,
      topics: message.topics,
    });
    if (
      keccak256(decoded.args._message).toLowerCase() !== id.toLowerCase() ||
      !message.transactionHash
    )
      continue;
    const receipt = await client.getTransactionReceipt({ hash: message.transactionHash });
    if (receipt.status !== "success" || receipt.blockNumber < from || receipt.blockNumber > to)
      continue;
    if (
      !receipt.logs.some(
        (log) =>
          isAddressEqual(log.address, L1_MESSENGER) &&
          log.data === message.data &&
          log.topics[0] === message.topics[0] &&
          log.topics[1] === message.topics[1] &&
          log.topics[2] === message.topics[2]
      )
    )
      continue;
    for (const log of receipt.logs) {
      if (
        !isAddressEqual(log.address, governor) ||
        log.topics[0] !== topicOf(l2GovernorAbi, "ProposalExecuted")
      )
        continue;
      const { args } = decodeEventLog({
        abi: l2GovernorAbi,
        eventName: "ProposalExecuted",
        data: log.data,
        topics: log.topics,
      });
      return {
        governor,
        proposalId: args.proposalId.toString(),
        executedTx: message.transactionHash,
      };
    }
  }
  return null;
}
