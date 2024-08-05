import dotenv from "dotenv";
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";
dotenv.config({ path: ".env" });

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    env: process.env,
    globals: true,
    poolOptions: {
      threads: {
        singleThread: true,
      },
    },
    setupFiles: ["test/setup.integration.ts"],
    include: ["test/integration/*.{test,spec}.{ts,tsx}"],
  },
});
