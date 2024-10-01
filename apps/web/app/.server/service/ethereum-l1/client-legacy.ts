import { env } from "@config/env.server";
import { BlockExplorerClient, RpcClient } from "@repo/common/ethereum";
import { EthereumConfig } from "@config/ethereum.server";

export const legacyL1Rpc = new RpcClient(EthereumConfig.l1.rpcUrl);

export const l1Explorer = BlockExplorerClient.forL1(
  env.ETHERSCAN_API_KEY,
  EthereumConfig.legacyClientNetwork
);
