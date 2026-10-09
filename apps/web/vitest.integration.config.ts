import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

// Integration tests talk to real networks, read-only: mainnet through a public RPC with log
// history (override with L1_RPC_URL) and the public Safe Transaction Service.
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    environment: "node",
    include: ["test/integration/*.{test,spec}.{ts,tsx}"],
    testTimeout: 300_000,
    hookTimeout: 300_000,
    env: {
      L1_RPC_URL: process.env.L1_RPC_URL ?? "https://mainnet.gateway.tenderly.co",
      LOG_LEVEL: "warn",
      // The RPC above, not one saved in apps/web/.cache/local-settings.json. Only the RPC
      // settings are ignored: a saved SAFE_API_KEY still applies (keyless, Safe allows 2 req/s).
      LOCAL_SETTINGS_IGNORE: "L1_RPC_URL,L2_RPC_URL",
    },
  },
});
