import { defineConfig } from "@playwright/test";

export default defineConfig({
  workers: 1, // Run serially to avoid browser session collisions
  testDir: "./suites/full",
  testMatch: /.*\.(spec|test)\.ts$/,
  use: {
    baseURL: "http://localhost:4000",
    viewport: { width: 1366, height: 768 },
  },
  timeout: 60_000, // 1 minute
  reporter: [["html"], ["list"]],
  retries: 1,
});
