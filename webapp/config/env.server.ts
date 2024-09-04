import { addressSchema } from "@/common/basic-schemas";
import { EthNetworkEnum } from "@/common/eth-network-enum";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const NodeEnvEnum = z.enum(["development", "test", "production"]);

const boolFromStrSchema = z.enum(["true", "false"])
  .default("true").transform(v => v === "true")

export const env = createEnv({
  server: {
    ALLOW_INDEXING: z.coerce.boolean().default(false),
    DATABASE_URL: z.string(),
    LOG_LEVEL: z.enum(["debug", "info"]).default("info"),
    NODE_ENV: NodeEnvEnum.default("production"),
    SERVER_PORT: z.coerce.number().default(3000),
    WALLET_CONNECT_PROJECT_ID: z.string(),
    L1_RPC_URL: z.string().url(),
    L2_RPC_URL: z.string().url(),
    ETH_NETWORK: EthNetworkEnum.default("mainnet"),
    ETHERSCAN_API_KEY: z.string(),
    UPGRADE_HANDLER_ADDRESS: addressSchema,
    SKIP_REPORTS: z.coerce.boolean().default(false),
    ZK_GOV_OPS_GOVERNOR_ADDRESS: addressSchema,
    ZK_TOKEN_GOVERNOR_ADDRESS: addressSchema,
    SHOW_PRIVATE_ACTIONS: boolFromStrSchema,
  },
  // eslint-disable-next-line n/no-process-env
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});

export const clientEnv = {
  ALLOW_INDEXING: env.ALLOW_INDEXING,
  NODE_ENV: env.NODE_ENV,
  ETH_NETWORK: env.ETH_NETWORK,
  WALLET_CONNECT_PROJECT_ID: env.WALLET_CONNECT_PROJECT_ID,
  SHOW_PRIVATE_ACTIONS: env.SHOW_PRIVATE_ACTIONS
};

export type CLIENT_ENV = typeof clientEnv;

declare global {
  interface Window {
    ENV: CLIENT_ENV;
  }
}
