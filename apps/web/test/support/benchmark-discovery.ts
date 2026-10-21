// Read-only comparison. Run from apps/web with tsx -r dotenv/config.
import { writeFile } from "node:fs/promises";
import { appStatus } from "../../app/.server/status";
import { clearCache } from "../../app/.server/cache";
import { resetLogCaches } from "../../app/.server/logs";
import { network, resetRpcClients } from "../../app/.server/rpc";
import { findL2ProposalForUpgrade } from "../../app/.server/flows/l2";
import { getStandardUpgradeOverview } from "../../app/.server/flows/standard";
const id = "0x77d5461c37515d627820ab6573efe63fb0b253cf83308dbb368b859e9835eaaa" as const;
const status = await appStatus();
if (
  !status.ok ||
  status.governance.warnings.length ||
  status.governance.network.overrides.length ||
  status.logHistory.status !== "ok"
)
  throw new Error("Trust status needs review; stopped");
const overview = await getStandardUpgradeOverview(id);
const originalFetch = globalThis.fetch;
const results: {
  strategy: "legacy" | "batch";
  ms: number;
  httpRequests: number;
  methods: Record<string, number>;
  result: Awaited<ReturnType<typeof findL2ProposalForUpgrade>>;
}[] = [];
for (const strategy of ["legacy", "batch", "batch", "legacy"] as const) {
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
    const result = await findL2ProposalForUpgrade(id, overview.status.creationTimestamp, {
      strategy,
      startedTxHash: overview.started.txHash,
    });
    const measurement = {
      strategy,
      ms: Math.round(performance.now() - start),
      httpRequests,
      methods,
      result,
    };
    results.push(measurement);
    console.log(JSON.stringify(measurement));
  } finally {
    globalThis.fetch = originalFetch;
  }
}
if (
  results.some((r) => !r.result || JSON.stringify(r.result) !== JSON.stringify(results[0]?.result))
)
  throw new Error("Discovery results disagree or no match was found");
await writeFile(
  "../../.cache/local/discovery-comparison.json",
  JSON.stringify({ id, results }, null, 2)
);
