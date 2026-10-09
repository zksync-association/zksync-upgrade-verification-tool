// Read-only: run from apps/web with tsx -r dotenv/config test/support/benchmark-emergency.ts.
import { writeFile } from "node:fs/promises";
import { appStatus } from "../../app/.server/status";
import { clearCache } from "../../app/.server/cache";
import { resetLogCaches } from "../../app/.server/logs";
import { network, resetRpcClients } from "../../app/.server/rpc";
import { findEmergencyEvent } from "../../app/.server/flows/emergency-event";
import { EMERGENCY_ID, EMERGENCY_TX } from "./fixtures";

const status = await appStatus();
if (
  !status.ok ||
  status.governance.warnings.length ||
  status.governance.network.overrides.length ||
  status.logHistory.status !== "ok"
)
  throw new Error("Trust status needs review; stopped");

const originalFetch = globalThis.fetch;
const results = [];
for (let run = 0; run < 2; run++) {
  clearCache();
  resetLogCaches();
  resetRpcClients();
  await network();
  const methods: Record<string, number> = {};
  let httpRequests = 0;
  globalThis.fetch = async (input, init) => {
    if (typeof init?.body === "string") {
      const parsed = JSON.parse(init.body);
      const requests = Array.isArray(parsed) ? parsed : [parsed];
      if (requests.some((r) => typeof r.method === "string")) {
        httpRequests++;
        for (const r of requests) methods[r.method] = (methods[r.method] ?? 0) + 1;
      }
    }
    return originalFetch(input, init);
  };
  const start = performance.now();
  try {
    const event = await findEmergencyEvent(EMERGENCY_ID);
    if (!event || event.txHash !== EMERGENCY_TX || event.blockNumber !== 25_766_164n)
      throw new Error("Emergency execution disagrees with the recorded mainnet evidence");
    const measurement = {
      ms: Math.round(performance.now() - start),
      httpRequests,
      methods,
      id: event.id,
      txHash: event.txHash,
      blockNumber: event.blockNumber.toString(),
    };
    results.push(measurement);
    console.log(JSON.stringify(measurement));
  } finally {
    globalThis.fetch = originalFetch;
  }
}
await writeFile("../../.cache/local/emergency-discovery.json", JSON.stringify(results, null, 2));
