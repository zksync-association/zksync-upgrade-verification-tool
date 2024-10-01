import { BlockExplorerClient } from "@repo/common/ethereum";
import {
  createPublicClient,
  type Hex,
  http,
  type Abi,
  type AbiEvent,
  type Address,
  type BlockTag,
  type ContractEventName,
  decodeEventLog,
  getAbiItem,
} from "viem";
import { zksync } from "viem/chains";
import { getLogProof } from "viem/zksync";
import { EthereumConfig } from "@config/ethereum.server";

export type MessageProof = {
  id: number;
  proof: Hex[];
  root: Hex;
};

export const l2Rpc = createPublicClient({
  transport: http(EthereumConfig.l2.rpcUrl),
  chain: zksync,
});

/**
 * This function is implemented like this because `zks_getL2ToL1LogProof` is not implemented
 * in era-test-node. At the same time in the development environment we are not actually validating
 * the proofs. So, we have different implementations per environment.
 *
 * In development, we check if the tx exist. If it exists we assume that it should have proofs,
 * so we return fake proofs.
 *
 * In non-dev environments we query for the real proofs.
 * @param txHash
 * @param index
 */
export async function fetchL2LogProof(txHash: Hex, index: number): Promise<MessageProof | null> {
  if (EthereumConfig.supportsLogProof) {
    return getLogProof(l2Rpc, { txHash, index });
  }

  // In development, we just check that the tx exists. If tx does not exist this raises an error.
  try {
    await l2Rpc.getTransactionReceipt({ hash: txHash });
    return {
      proof: [txHash],
      root: txHash,
      id: 0,
    };
  } catch (_e) {
    return null;
  }
}

export async function queryL2Logs<A extends Abi, N extends ContractEventName<A>>(
  abi: A,
  address: Address,
  eventName: N,
  fromBlock: bigint,
  toBlock: bigint | BlockTag = "latest"
) {
  const args1 = {};
  return l2Rpc
    .getLogs({
      address: address,
      event: getAbiItem({
        abi,
        name: eventName,
      } as any) as AbiEvent,
      fromBlock: fromBlock,
      toBlock: toBlock,
      args: args1,
    })
    .then((logs) =>
      logs.map((log) => {
        const decoded = decodeEventLog({
          abi,
          eventName,
          data: log.data,
          topics: log.topics,
        });
        return {
          ...decoded,
          transactionHash: log.transactionHash,
        };
      })
    );
}

export async function getLatestL2Block() {
  return l2Rpc.getBlock({ blockTag: "latest" });
}

export const l2Explorer = BlockExplorerClient.forL2(EthereumConfig.legacyClientNetwork);
