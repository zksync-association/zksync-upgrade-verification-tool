import { z } from "zod";
import type { Hex } from "viem";

export const ETHERSCAN_ENDPOINTS = {
  mainnet: "https://api.etherscan.io/api",
  sepolia: "https://api-sepolia.etherscan.io/api",
} as const;

export const ERA_BLOCK_EXPLORER_ENDPOINTS = {
  mainnet: "https://block-explorer-api.mainnet.zksync.io/api",
  sepolia: "https://block-explorer-api.sepolia.zksync.dev/api",
} as const;

export const DIAMOND_ADDRS: Record<Network, Hex> = {
  mainnet: "0x32400084c286cf3e17e7b677ea9583e60a000324",
  sepolia: "0x9a6de0f62aa270a8bcb1e2610078650d539b1ef9",
};

export const NET_VERSIONS = {
  mainnet: "1",
  sepolia: "11155111",
};

export const NetworkSchema = z.enum(["mainnet", "sepolia"]);

export type Network = z.infer<typeof NetworkSchema>;

export const ADDRESS_ZERO = `0x${"0".repeat(40)}`;
// export const ZERO_U256 = `0x${"0".repeat(64)}`;
export const OPEN_ZEP_PROXY_IMPL_SLOT =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
