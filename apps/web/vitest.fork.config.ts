import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

// Write paths against the real mainnet contracts on a local anvil fork (needs anvil and network
// access to fork from; FORK_URL overrides the default public archive RPC). Signatures come from a
// test key that the fork makes an owner of member Safes, served by a local mock Safe API.
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    environment: "node",
    include: ["test/fork/*.{test,spec}.ts"],
    testTimeout: 300_000,
    hookTimeout: 300_000,
    fileParallelism: false,
    env: {
      L1_RPC_URL: "http://127.0.0.1:18545",
      SAFE_TX_SERVICE_URL: "http://127.0.0.1:18546",
      LOG_LEVEL: "warn",
      // The fork, not an RPC saved in apps/web/.cache/local-settings.json. Only the RPC settings
      // are ignored: a saved SAFE_API_KEY still applies.
      LOCAL_SETTINGS_IGNORE: "L1_RPC_URL,L2_RPC_URL",
    },
  },
});
