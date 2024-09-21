import { env } from "@config/env.server";
import { BlockExplorerClient, RpcClient } from "@repo/common/ethereum";

export const legacyL1Rpc = new RpcClient(env.L1_RPC_URL);

const network = env.ETH_NETWORK === "local" ? "sepolia" : env.ETH_NETWORK;

export const l1Explorer = BlockExplorerClient.forL1(env.ETHERSCAN_API_KEY, network);
