import { defaultLogger } from "@config/log.server";
import type { Address } from "viem";
import { l2GovernorIndex } from "./chain/l2-index";
import { puhIndex } from "./chain/puh-index";
import { warmMessageReadings } from "./flows/messages";
import { type Governance, governance } from "./governance";
import { checkLogHistory } from "./logs";
import { l1, network, rpcGeneration } from "./rpc";
import { warmSafeListing } from "./safe/store";
import { backgroundSafeReadsAllowed } from "./safe-api";

// One warm-up after the server starts (and after a settings change): the reads every first page
// waits on, through the same cached functions requests use. It never rejects, and it logs step
// names, timings, counts and error class names only: an error message can carry the RPC URL.

const log = defaultLogger.child({ module: "prewarm" });

type PrewarmReason = "boot" | "settings";

/** PREWARM=0 (or false/off/no) turns the warm-up off, at start and after settings changes. */
export function shouldPrewarm(env: Record<string, string | undefined> = process.env): boolean {
  return !/^(0|false|off|no)$/i.test(env.PREWARM?.trim() ?? "");
}

/** A class name such as "HttpRequestError", never the error's text. */
function errorKind(error: unknown): string {
  const name = error instanceof Error ? error.name : typeof error;
  return /^[A-Za-z]\w{0,63}$/.test(name) ? name : "Error";
}

const elapsed = (since: number) => Math.round(performance.now() - since);

type Fields = Record<string, string | number | boolean | null>;

async function step<T>(
  reason: PrewarmReason,
  name: string,
  run: () => Promise<T>,
  { details, progress }: { details?: (value: T) => Fields; progress?: () => Fields } = {}
): Promise<T | null> {
  const started = performance.now();
  try {
    const value = await run();
    log.info(
      { reason, step: name, ms: elapsed(started), ...details?.(value), ...progress?.() },
      "prewarm step"
    );
    return value;
  } catch (error) {
    log.warn(
      { reason, step: name, ms: elapsed(started), error: errorKind(error), ...progress?.() },
      "prewarm step failed"
    );
    return null;
  }
}

/** The Safes whose message listings the governance pages read: SC and Guardians members, ZKF. */
export function governanceSafes(gov: Governance): Address[] {
  const unique = new Map<string, Address>();
  for (const safe of [
    ...gov.securityCouncil.members,
    ...gov.guardians.members,
    gov.emergencyUpgradeBoard.zkFoundation,
  ])
    if (!unique.has(safe.toLowerCase())) unique.set(safe.toLowerCase(), safe);
  return [...unique.values()];
}

async function warm(reason: PrewarmReason, generation: number): Promise<void> {
  const started = performance.now();
  try {
    await warmSteps(reason, generation);
  } finally {
    log.info({ reason, step: "done", ms: elapsed(started) }, "prewarm finished");
  }
}

async function warmSteps(reason: PrewarmReason, generation: number): Promise<void> {
  // A settings change since the start: the new settings get their own warm-up. Logged once.
  let stopped = false;
  const superseded = () => {
    if (stopped) return true;
    if (rpcGeneration() === generation) return false;
    stopped = true;
    log.info({ reason, step: "superseded" }, "prewarm stopped");
    return true;
  };

  const net = await step(reason, "network", () => network(), {
    details: (n) => ({ chainId: n.chainId }),
  });
  if (!net || superseded()) return;

  // Era's index backfills beside the rest (another provider); nothing below waits for it.
  const l2 = step(
    reason,
    "l2-index",
    async () => {
      const index = l2GovernorIndex();
      await index.startBackfill();
      return index.status();
    },
    {
      details: (status) => ({
        state: status.state,
        strategy: status.strategy,
        logs: status.logs,
      }),
    }
  );
  try {
    await warmL1(reason, net, superseded);
  } finally {
    await l2;
  }
}

async function warmL1(
  reason: PrewarmReason,
  net: { safeTxServiceUrl: string | null },
  superseded: () => boolean
): Promise<void> {
  const governed = step(reason, "governance", () => governance());
  const history = Promise.all([
    step(reason, "log-history", () => checkLogHistory(l1), {
      details: (history) => ({ status: history.status }),
    }),
    step(
      reason,
      "log-index",
      async () => {
        const index = puhIndex();
        await index.startBackfill();
        return index.status();
      },
      {
        details: (status) => ({
          state: status.state,
          strategy: status.strategy,
          chunks: status.chunks.total,
          logs: status.logs,
        }),
      }
    ),
  ]);
  // Safe listings need only governance, so they are read while the log index backfills; then the
  // messages held are parsed and hashed before the first page needs them.
  const gov = await governed;
  const listings =
    gov && !superseded()
      ? warmListings(reason, net, gov, superseded).then(() =>
          superseded()
            ? null
            : step(reason, "safe-messages", () => warmMessageReadings(governanceSafes(gov)), {
                details: (read) => ({ read }),
              })
        )
      : null;
  await Promise.all([history, listings]);
}

async function warmListings(
  reason: PrewarmReason,
  net: { safeTxServiceUrl: string | null },
  gov: Governance,
  superseded: () => boolean
): Promise<void> {
  // Low priority: one listing at a time, behind pages' Safe reads, within the background budget.
  // Only with SAFE_API_KEY or a self-hosted service: keyless, the public service's monthly per-IP
  // quota is kept for the pages actually opened.
  if (!net.safeTxServiceUrl) {
    log.info({ reason, step: "safe-listings", skipped: "no-service" }, "prewarm step");
    return;
  }
  if (!backgroundSafeReadsAllowed(net.safeTxServiceUrl)) {
    log.info({ reason, step: "safe-listings", skipped: "keyless-public-service" }, "prewarm step");
    return;
  }
  const safes = governanceSafes(gov);
  let listed = 0;
  await step(
    reason,
    "safe-listings",
    async () => {
      for (const safe of safes) {
        if (superseded()) return;
        await warmSafeListing(safe);
        listed++;
      }
    },
    { progress: () => ({ listed, of: safes.length }) }
  );
}

let running: { generation: number; run: Promise<void> } | null = null;

/** Reads network() before the server listens (not turned off by PREWARM=0); never rejects. */
export async function readNetwork(): Promise<void> {
  await step("boot", "network-before-listen", network, {
    details: (net) => ({ chainId: net.chainId }),
  });
}

/** Runs the warm-up, one run per settings generation at a time; never rejects. */
export function prewarm(reason: PrewarmReason): Promise<void> {
  try {
    if (!shouldPrewarm()) return Promise.resolve();
    const generation = rpcGeneration();
    if (running?.generation === generation) return running.run;
    const run: Promise<void> = warm(reason, generation)
      .catch((error: unknown) => {
        try {
          log.warn({ reason, step: "prewarm", error: errorKind(error) }, "prewarm failed");
        } catch {
          // Never rejects, not even when logging fails.
        }
      })
      .finally(() => {
        if (running?.run === run) running = null;
      });
    running = { generation, run };
    return run;
  } catch {
    return Promise.resolve();
  }
}
