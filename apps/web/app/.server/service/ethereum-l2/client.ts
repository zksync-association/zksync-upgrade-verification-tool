import { env } from "@config/env.server";
import { BlockExplorerClient } from "@repo/common/ethereum";
import { createPublicClient, type Hex, http } from "viem";
import { zksync } from "viem/chains";
import { getLogProof } from "viem/zksync";

const network = env.ETH_NETWORK === "local" ? "sepolia" : env.ETH_NETWORK;

export type MessageProof = {
  id: number;
  proof: Hex[];
  root: Hex;
};

export const l2Rpc = createPublicClient({
  transport: http(env.L2_RPC_URL),
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
export async function fetchLogProof(txHash: Hex, index: number): Promise<MessageProof | null> {
  if (env.ETH_NETWORK === "local") {
    try {
      // In development, we just check that the tx exists. If tx does not exist this raise an error.
      await l2Rpc.getTransactionReceipt({ hash: txHash });
      return {
        proof: [txHash],
        root: txHash,
        id: 0,
      };
    } catch (_e) {
      return null;
    }
  } else {
    return getLogProof(l2Rpc, { txHash, index });
  }
}

export async function getLatestBlock() {
  return l2Rpc.getBlock({ blockTag: "latest" });
}

export const l2Explorer = BlockExplorerClient.forL2(network);
