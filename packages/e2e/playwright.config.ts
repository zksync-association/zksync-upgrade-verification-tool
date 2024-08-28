import { defineConfig } from "@playwright/test";
export default defineConfig({
  workers: 1, // Run serially to avoid browser session collisions
  testDir: "./suites/full",
  testMatch: /.*\.(spec|test)\.ts$/,
  use: {
    baseURL: "http://localhost:3000",
    viewport: { width: 1366, height: 768 },
  },
  timeout: 3000000,

  //   webServer: [
  //     {
  //       command: "yarn preview --port 8080",
  //       url: "http://localhost:8080",
  //       timeout: 5000,
  //       reuseExistingServer: true,
  //     },
  //     {
  //       command: "yarn chain",
  //       url: "http://localhost:8546",
  //       timeout: 5000,
  //       reuseExistingServer: true,
  //     },
  //   ],
});
