import { env } from "@config/env.server";
import { BlockExplorerClient, RpcClient } from "@repo/common/ethereum";
import { createPublicClient, type Hex, http } from "viem";
import { zksync } from "viem/chains";

const network = env.ETH_NETWORK === "local" ? "sepolia" : env.ETH_NETWORK;

export const l2RpcDeprecated = new RpcClient(env.L2_RPC_URL);

export const l2Rpc = createPublicClient({
  transport: http(env.L2_RPC_URL),
  chain: zksync
})

export async function getLatestBlock() {
  return l2Rpc.getBlock({blockTag: "latest"})
}

export const l2Explorer = BlockExplorerClient.forL2(network);
