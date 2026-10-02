import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

// Pure server logic: no network. Modules that would talk to an RPC get a dummy URL.
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    environment: "node",
    include: ["test/server/*.{test,spec}.{ts,tsx}"],
    env: { L1_RPC_URL: "http://127.0.0.1:9", LOG_LEVEL: "error" },
  },
});
