import { env } from "@config/env.server";
import { createPublicClient, http } from "viem";

export const l1Rpc = createPublicClient({
  transport: http(env.L1_RPC_URL),
});

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
    console.error("Error checking connection to :", env.L1_RPC_URL);
    if (error instanceof Error) {
      console.error(error.message);
      console.error(error.cause);
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
        `Upgrade handler contract not found at ${env.UPGRADE_HANDLER_ADDRESS} on L1 Network "${process.env.ETH_NETWORK}"`
      );
    }
    return;
  }
  throw new Error(`Connection to L1 "${process.env.ETH_NETWORK}" network failed`);
};
