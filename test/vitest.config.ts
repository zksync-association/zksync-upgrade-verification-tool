import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    reporters: ["default"],
    testTimeout: 60000,
    fileParallelism: false,
    sequence: {
      concurrent: false,
    },
    pool: "threads",
    poolOptions: {
      threads: {
        singleThread: true,
        maxThreads: 1,
      },
    },
    maxWorkers: 1
  },
});
