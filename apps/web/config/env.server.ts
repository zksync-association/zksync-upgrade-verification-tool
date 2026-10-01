import { addressSchema } from "@repo/common/schemas";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";
import "dotenv/config";

export const NodeEnvEnum = z.enum(["development", "test", "production"]);

// Only L1_RPC_URL is required. Everything else is optional and either derived from the chain
// (network, governance contracts, members, thresholds) or has a per-network default.
export const env = createEnv({
  server: {
    L1_RPC_URL: z.string().url(),
    L2_RPC_URL: z.string().url().optional(),
    // Signing through WalletConnect is disabled without it. Verifying never needs it.
    WALLET_CONNECT_PROJECT_ID: z.string().optional(),
    // Only needed when the Safe Transaction Service rate limits you (e.g. a hosted instance).
    SAFE_API_KEY: z.string().optional(),
    // Overrides for local chains and tests. Mainnet and Sepolia have pinned defaults.
    UPGRADE_HANDLER_ADDRESS: addressSchema.optional(),
    SAFE_TX_SERVICE_URL: z.string().url().optional(),
    ZK_PROTOCOL_GOVERNOR_ADDRESS: addressSchema.optional(),
    ZK_TOKEN_GOVERNOR_ADDRESS: addressSchema.optional(),
    ZK_GOV_OPS_GOVERNOR_ADDRESS: addressSchema.optional(),
    ALLOW_INDEXING: z.coerce.boolean().default(false),
    LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
    NODE_ENV: NodeEnvEnum.default("production"),
    SERVER_PORT: z.coerce.number().default(3000),
    // Local runs answer only this machine (the app spends the user's RPC); the image sets 0.0.0.0.
    SERVER_HOST: z.string().default("127.0.0.1"),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
  skipValidation: process.env.SKIP_ENV_VALIDATION === "true",
});

export const clientEnv = {
  ALLOW_INDEXING: env.ALLOW_INDEXING,
  NODE_ENV: env.NODE_ENV,
  WALLET_CONNECT_PROJECT_ID: env.WALLET_CONNECT_PROJECT_ID ?? null,
};

export type CLIENT_ENV = typeof clientEnv;

declare global {
  interface Window {
    ENV: CLIENT_ENV;
  }
}
