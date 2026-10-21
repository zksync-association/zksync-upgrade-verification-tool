import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

// Pure server logic: no network. Modules that would talk to an RPC get a dummy URL.
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    environment: "node",
    include: ["test/server/*.{test,spec}.{ts,tsx}"],
    // Many tests drive the sync engine through hundreds of fake blocks, and a few wait on real
    // retry timers: 1-4 s alone, past the 5 s default when the machine is busy. A hung test still fails.
    testTimeout: 20_000,
    // IGNORE_LOCAL_SETTINGS: a developer's saved RPC (apps/web/.cache) must not replace the dummy.
    // SYNC_CREDITS_PER_SECOND=0: the engine's credit pacer only stretches fake time here; its own
    // tests (pacer.test.ts) turn it on.
    env: {
      L1_RPC_URL: "http://127.0.0.1:9",
      LOG_LEVEL: "error",
      IGNORE_LOCAL_SETTINGS: "true",
      SYNC_CREDITS_PER_SECOND: "0",
    },
  },
});
