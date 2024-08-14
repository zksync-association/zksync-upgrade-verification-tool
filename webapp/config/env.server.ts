import { hexSchema } from "@/common/basic-schemas";
import { EthNetworkEnum } from "@/common/eth-network-enum";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const NodeEnvEnum = z.enum(["development", "test", "production"]);
export type NodeEnv = z.infer<typeof NodeEnvEnum>;

export const env = createEnv({
  server: {
    ALLOW_INDEXING: z.coerce.boolean().default(false),
    DATABASE_URL: z.string(),
    LOG_LEVEL: z.enum(["debug", "info"]).default("info"),
    NODE_ENV: NodeEnvEnum.default("production"),
    SERVER_PORT: z.coerce.number().default(3000),
    WALLET_CONNECT_PROJECT_ID: z.string(),
    L1_RPC_URL: z.string(),
    ETH_NETWORK: EthNetworkEnum.default("mainnet"),
    ETHERSCAN_API_KEY: z.string(),
    UPGRADE_HANDLER_ADDRESS: hexSchema,
    SKIP_REPORTS: z.coerce.boolean().default(false),
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
};

export type CLIENT_ENV = typeof clientEnv;

declare global {
  interface Window {
    ENV: CLIENT_ENV;
  }
}
