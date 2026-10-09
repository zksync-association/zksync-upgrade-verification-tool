import { defaultLogger } from "@config/log.server";
import type { Address } from "viem";
import { puhIndex } from "./chain/puh-index";
import { type Governance, governance } from "./governance";
import { checkLogHistory } from "./logs";
import { l1, network, rpcGeneration } from "./rpc";
import { backgroundSafeReadsAllowed, listSafeMessages } from "./safe-api";

// One warm-up after the server starts (and after a settings change): the reads every first page
// waits on, made before anyone asks, through the same cached functions requests use. A request
// that arrives mid-way joins the read in flight. Nothing here decides anything a page shows; the
// caches keep their usual lifetimes. It never rejects, and it logs step names, timings, counts and
// error class names only: an error message can carry the RPC URL and its key.

const log = defaultLogger.child({ module: "prewarm" });

export type PrewarmReason = "boot" | "settings";

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

/**
 * Runs one step, logs how it went, and returns its value (null when it failed). `details` adds
 * fields from the value; `progress` adds fields either way.
 */
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
  // A settings change since the start: the new settings get their own warm-up.
  const superseded = () => {
    if (rpcGeneration() === generation) return false;
    log.info({ reason, step: "superseded" }, "prewarm stopped");
    return true;
  };

  const net = await step(reason, "network", () => network(), {
    details: (n) => ({ chainId: n.chainId }),
  });
  // Everything below reads the network first; without it each step would fail the same way.
  if (!net || superseded()) return;

  const [gov] = await Promise.all([
    step(reason, "governance", () => governance()),
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
  if (!gov || superseded()) return;

  // Low priority: one listing at a time, so a page's own Safe reads queue behind at most one of
  // these in the Safe API's rate limiter. The first failure (often a rate limit) ends the step.
  // Only with SAFE_API_KEY or a self-hosted service: keyless, the public service's monthly per-IP
  // quota is better kept for the pages that are actually opened.
  if (!net.safeTxServiceUrl) {
    log.info({ reason, step: "safe-listings", skipped: "no-service" }, "prewarm step");
  } else if (!backgroundSafeReadsAllowed(net.safeTxServiceUrl)) {
    log.info({ reason, step: "safe-listings", skipped: "keyless-public-service" }, "prewarm step");
  } else {
    const safes = governanceSafes(gov);
    let listed = 0;
    await step(
      reason,
      "safe-listings",
      async () => {
        for (const safe of safes) {
          if (superseded()) return;
          await listSafeMessages(safe);
          listed++;
        }
      },
      { progress: () => ({ listed, of: safes.length }) }
    );
  }
}

let running: { generation: number; run: Promise<void> } | null = null;

/**
 * Warms network(), then together governance(), the log-history canary and the
 * ProtocolUpgradeHandler log index backfill, then (with SAFE_API_KEY or a self-hosted service) the
 * governance Safes' message listings. One run per settings generation at a time; never rejects.
 */
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
