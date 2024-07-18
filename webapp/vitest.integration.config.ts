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
    setupFiles: ["app/test/setup.integration.ts"],
    include: ["app/test/integration/*.{test,spec}.{ts,tsx}"],
  },
});
