import {
  type Abi,
  type AbiEvent,
  type Address,
  type BlockTag,
  type ContractEventName,
  decodeEventLog,
  getAbiItem
} from "viem";
import { l2Rpc } from "@/.server/service/ethereum-l2/client";
import { env } from "@config/env.server";

export async function queryLogs<A extends Abi, N extends ContractEventName<A>>(
  abi: A,
  address: Address,
  eventName: N,
  fromBlock: bigint,
  toBlock: bigint | BlockTag = "latest"
) {
  const args1 = {};
  return l2Rpc.getLogs({
    address: address,
    event: getAbiItem({
      abi,
      name: eventName
    } as any) as AbiEvent,
    fromBlock: fromBlock,
    toBlock: toBlock,
    args: args1
  }).then(logs =>
    logs.map((log) => {
      const decoded = decodeEventLog({
        abi,
        eventName,
        data: log.data,
        topics: log.topics,
      });
      return {
        ...decoded,
        transactionHash: log.transactionHash
      }
    })
  );
}

export function blocksInADay() {
  if (env.ETH_NETWORK === "mainnet" || env.ETH_NETWORK === "local") {
    return 24 * 3600; // 24 hours, 1 block per second
  }
  return 24 * (3600 / 20); // 20 seconds per block.
}