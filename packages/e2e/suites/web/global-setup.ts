import { type ChildProcess, spawn } from "node:child_process";
import { mkdirSync, openSync, writeFileSync } from "node:fs";
import path from "node:path";
import { startFork } from "../../../../apps/web/test/support/fork";
import { startMockSafe } from "../../../../apps/web/test/support/mock-safe";
import { ANVIL_PORT, APP_URL, SAFE_PORT, SAFE_SHELL_PORT, SNAPSHOT_FILE } from "./support";

const WEB_DIR = path.resolve(import.meta.dirname, "../../../../apps/web");
const LOGS = path.resolve(import.meta.dirname, "../../logs");

// Fork at block 26089400 (upgrade 0x77d5… waiting for approval), mock Safe API with the recorded
// mainnet messages, and the production build of the app pointed at both.
export default async function globalSetup() {
  mkdirSync(LOGS, { recursive: true });
  const fork = await startFork({ port: ANVIL_PORT });
  const safe = await startMockSafe({ port: SAFE_PORT });
  writeFileSync(SNAPSHOT_FILE, await fork.snapshot());

  const log = openSync(path.join(LOGS, "app.log"), "w");
  const app: ChildProcess = spawn("node", ["./server-build/index.js"], {
    cwd: WEB_DIR,
    stdio: ["ignore", log, log],
    env: {
      ...process.env,
      L1_RPC_URL: fork.url,
      SAFE_TX_SERVICE_URL: safe.url,
      SERVER_PORT: "4000",
      LOG_LEVEL: "warn",
      WALLET_CONNECT_PROJECT_ID: "",
      SAFE_WALLET_ORIGINS: `https://app.safe.global,http://127.0.0.1:${SAFE_SHELL_PORT}`,
      // The fork above, not an RPC saved in apps/web/.cache/local-settings.json (and nothing the
      // suite saves through the settings page lands in that file).
      IGNORE_LOCAL_SETTINGS: "true",
      // Open sets' member Safes asked about every 3 s (live-updates.spec.ts), without the hourly
      // budget stretching that (the mock Safe API is local).
      SYNC_SAFE_WATCH_MS: "3000",
      SYNC_SAFE_HOURLY_BUDGET: "1000000",
    },
  });
  for (let i = 0; ; i++) {
    try {
      if ((await fetch(`${APP_URL}/api/status`)).ok) break;
    } catch {}
    if (i > 240) throw new Error("app did not start; see packages/e2e/logs/app.log");
    await new Promise((r) => setTimeout(r, 500));
  }

  return async () => {
    app.kill();
    await safe.close();
    fork.stop();
  };
}
