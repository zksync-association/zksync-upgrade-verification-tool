import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    reporters: ["default"],
    testTimeout: 120000,
    fileParallelism: false,
    sequence: {
      concurrent: false,
    },
    globalSetup: "./testDelays.ts",
    include: ["suites/cli/*.{test,spec}.{ts,tsx}"],
  },
});
