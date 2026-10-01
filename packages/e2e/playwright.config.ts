import { defineConfig } from "@playwright/test";

// Browser tests of the production build (apps/web, built with `pnpm build`) against an anvil fork
// of mainnet and a local mock of the Safe Transaction Service. See suites/web/global-setup.ts.
export default defineConfig({
  testDir: "./suites/web",
  testMatch: /.*\.spec\.ts$/,
  globalSetup: "./suites/web/global-setup.ts",
  workers: 1, // one fork, one app
  fullyParallel: false,
  timeout: 180_000,
  expect: { timeout: 30_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:4000",
    viewport: { width: 1366, height: 900 },
    trace: "retain-on-failure",
    // PW_CHANNEL=chrome uses an installed Google Chrome instead of Playwright's Chromium.
    ...(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {}),
  },
});
