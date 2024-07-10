import { env } from "@config/env.server";
import { BlockExplorerClient, RpcClient } from "validate-cli";

export const l1Explorer = BlockExplorerClient.forL1(env.ETHERSCAN_API_KEY, env.ETH_NETWORK);
export const l1Rpc = new RpcClient(env.L1_RPC_URL);
export const l2Explorer = BlockExplorerClient.forL2(env.ETH_NETWORK);
export const l1RpcProposals = new RpcClient(env.L1_RPC_URL_FOR_UPGRADES);
