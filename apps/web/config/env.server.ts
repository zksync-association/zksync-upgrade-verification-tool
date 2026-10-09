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
    // The sync engine follows the chain head and refreshes, ahead of requests, what is on screen:
    // "window" (only while the app is in use: nothing is sent upstream while nobody uses it),
    // "always" (follows the head for as long as the server runs; what is on screen still only
    // while in use), or "off" (every request reads on demand). The app is in use while a visible
    // tab beat, or a page loaded, within SYNC_KEEPWARM_MS (sync/presence.ts); JSON (/api/*) never
    // counts. A visible tab nobody touched for SYNC_AWAY_MS stops counting (0: never). Dev nodes
    // (anvil, hardhat) always read on demand.
    SYNC_MODE: z.enum(["window", "always", "off"]).default("window"),
    SYNC_KEEPWARM_MS: z.coerce.number().int().min(0).default(30_000),
    SYNC_AWAY_MS: z.coerce.number().int().min(0).default(1_800_000),
    // While the engine runs, the member Safes of the signature sets on screen have their message
    // listings re-checked before they turn 60 s old; with SYNC_MODE=always every member Safe is
    // also checked at an interval paced by the Safe quota left (10-20 minutes with a key). Only
    // with SAFE_API_KEY or a self-hosted Safe service, and at most SYNC_SAFE_HOURLY_BUDGET
    // background requests an hour. SYNC_SAFE_ACTIVE_MS is no longer used (what is on screen
    // decides).
    SYNC_SAFE_ACTIVE_MS: z.coerce.number().int().min(0).default(300_000),
    SYNC_SAFE_HOURLY_BUDGET: z.coerce.number().int().min(0).default(1_200),
    // A signature set's checks at a head go out in one Multicall3 aggregate3 with the head's other
    // reads, and only positives are taken from it (ECDSA-only candidates on pinned contracts;
    // everything else is asked directly, where only a definite revert rejects). 0: every check
    // asked directly.
    SYNC_VERDICT_AGGREGATE: z.coerce.number().int().min(0).max(1).default(1),
    // The sync engine's own upstream work, at most this many Infura credits a second (eth_getLogs
    // 255, other methods 80; Infura's free plan allows 500). Requests are never held up. 0: unpaced.
    SYNC_CREDITS_PER_SECOND: z.coerce.number().int().min(0).default(450),
    // How the head follower looks for the next block: "slot" polls when its slot begins (the proof
    // that the local clock is not behind) and then every second; "late" makes the same proof poll,
    // then its first search poll where most blocks have arrived by (learned), then every second.
    SYNC_HEAD_POLL: z.enum(["slot", "late"]).default("slot"),
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
