// config/env.server.ts for the single-file build: no environment, only the saved settings
// (shims/local-settings.ts) over the server's defaults. Until an RPC URL is saved the modules that
// set up their RPC clients at load get a placeholder, and the app shows only its settings.
import { localSetting } from "./local-settings";
import { DEFAULT_WALLET_CONNECT_PROJECT_ID } from "@/common/walletconnect";

const defaults: Record<string, unknown> = {
  L1_RPC_URL: "https://rpc.not-configured.invalid",
  SAFE_WALLET_ORIGINS: "https://app.safe.global",
  SYNC_MODE: "window",
  SYNC_KEEPWARM_MS: 30_000,
  SYNC_AWAY_MS: 1_800_000,
  SYNC_SAFE_WATCH_MS: 60_000,
  SYNC_SAFE_LIST_WATCH_MS: 300_000,
  SYNC_SAFE_WATCH_KEYLESS_MS: 300_000,
  SYNC_SAFE_HOURLY_BUDGET: 1_200,
  SYNC_VERDICT_AGGREGATE: 1,
  SYNC_CREDITS_PER_SECOND: 450,
  ALLOW_INDEXING: false,
  LOG_LEVEL: "warn",
  NODE_ENV: "production",
  SERVER_PORT: 3000,
  SERVER_HOST: "127.0.0.1",
};

// biome-ignore lint/suspicious/noExplicitAny: the server's env is typed by its schema
export const env: any = new Proxy(defaults, {
  get(target, name) {
    const local = localSetting(String(name));
    return local === undefined ? Reflect.get(target, name) : local === null ? undefined : local;
  },
});

export const safeWalletOrigins = String(defaults.SAFE_WALLET_ORIGINS).split(",");
export const clientEnv = {
  ALLOW_INDEXING: false,
  NODE_ENV: "production" as const,
  get WALLET_CONNECT_PROJECT_ID(): string {
    return env.WALLET_CONNECT_PROJECT_ID ?? DEFAULT_WALLET_CONNECT_PROJECT_ID;
  },
  SAFE_WALLET_ORIGINS: safeWalletOrigins,
};
export type CLIENT_ENV = typeof clientEnv;
