import { addressSchema } from "@repo/common/schemas";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";
import "dotenv/config";
import { localSetting } from "./local-settings.server";

export const NodeEnvEnum = z.enum(["development", "test", "production"]);

// Only L1_RPC_URL is required. Everything else is optional and either derived from the chain
// (network, governance contracts, members, thresholds) or has a per-network default.
const baseEnv = createEnv({
  server: {
    L1_RPC_URL: z.string().url(),
    L2_RPC_URL: z.string().url().optional(),
    // Signing through WalletConnect is disabled without it. Verifying never needs it.
    WALLET_CONNECT_PROJECT_ID: z.string().optional(),
    // Safe{Wallet} instances that may open the app as a Safe App (comma-separated origins).
    SAFE_WALLET_ORIGINS: z
      .string()
      .default("https://app.safe.global")
      .refine(
        (value) => splitOrigins(value).every((o) => URL.canParse(o) && new URL(o).origin === o),
        "SAFE_WALLET_ORIGINS must be comma-separated origins, e.g. https://app.safe.global"
      ),
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

// Secret settings are server-only and override environment defaults for this local instance.
export const env = new Proxy(baseEnv, {
  get(target, name) {
    const local = localSetting(String(name));
    return local === undefined ? Reflect.get(target, name) : local === null ? undefined : local;
  },
});

function splitOrigins(value: string) {
  return value
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
}

export const safeWalletOrigins = splitOrigins(env.SAFE_WALLET_ORIGINS);

export const clientEnv = {
  ALLOW_INDEXING: env.ALLOW_INDEXING,
  NODE_ENV: env.NODE_ENV,
  WALLET_CONNECT_PROJECT_ID: env.WALLET_CONNECT_PROJECT_ID ?? null,
  SAFE_WALLET_ORIGINS: safeWalletOrigins,
};

export type CLIENT_ENV = typeof clientEnv;

declare global {
  interface Window {
    ENV: CLIENT_ENV;
  }
}
