import { env } from "@config/env.server";
import { BlockExplorerClient, RpcClient } from "@repo/common/ethereum";

const network = env.ETH_NETWORK === "local" ? "sepolia" : env.ETH_NETWORK;

export const l2Rpc = new RpcClient(env.L2_RPC_URL);

export const l2Explorer = BlockExplorerClient.forL2(network);
