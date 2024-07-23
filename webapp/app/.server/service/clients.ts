import { env } from "@config/env.server";
import { BlockExplorerClient, RpcClient } from "validate-cli";

export const l1Explorer = BlockExplorerClient.forL1(env.ETHERSCAN_API_KEY, env.ETH_NETWORK);
export const l1Rpc = new RpcClient(env.L1_RPC_URL);
export const l2Explorer = BlockExplorerClient.forL2(env.ETH_NETWORK);

export const checkConnection = async () => {
  try {
    const response = await fetch(env.L1_RPC_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "net_version",
        params: [],
        id: 1,
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data: any = await response.json();
    return "result" in data;
  } catch (error) {
    console.error("Error checking connection:", error);
    return false;
  }
};
