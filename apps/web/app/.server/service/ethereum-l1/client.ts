import { createPublicClient, http } from "viem";
import { EthereumConfig } from "@config/ethereum.server";
import { defaultLogger } from "@config/log.server";
import { env } from "@config/env.server";

export const l1Rpc = createPublicClient({
  transport: http(EthereumConfig.l1.rpcUrl),
});

export const checkConnection = async () => {
  try {
    const response = await fetch(EthereumConfig.l1.rpcUrl, {
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
    defaultLogger.error("Error checking connection to :", EthereumConfig.l1.rpcUrl);
    if (error instanceof Error) {
      defaultLogger.error(error.message);
      defaultLogger.error(error.cause);
    }
    return false;
  }
};

export const validateHandlerAddress = async () => {
  if (await checkConnection()) {
    const exists = await l1Rpc.getCode({
      address: env.UPGRADE_HANDLER_ADDRESS,
    });
    if (!exists) {
      throw new Error(
        `Upgrade handler contract not found at ${env.UPGRADE_HANDLER_ADDRESS} on L1 Network "${EthereumConfig.network}"`
      );
    }
    return;
  }
  throw new Error(`Connection to L1 "${EthereumConfig.network}" network failed`);
};

export async function getLatestL1BlockTimestamp() {
  const block = await l1Rpc.getBlock({ blockTag: "latest" });
  return block.timestamp;
}
