import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

// Pure server logic: no network. Modules that would talk to an RPC get a dummy URL.
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    environment: "node",
    include: ["test/server/*.{test,spec}.{ts,tsx}"],
    // IGNORE_LOCAL_SETTINGS: a developer's saved RPC (apps/web/.cache) must not replace the dummy.
    env: { L1_RPC_URL: "http://127.0.0.1:9", LOG_LEVEL: "error", IGNORE_LOCAL_SETTINGS: "true" },
  },
});
