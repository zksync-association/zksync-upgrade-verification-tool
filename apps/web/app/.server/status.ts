import { env } from "@config/env.server";
import { type PuhIndexStatus, puhIndex } from "./chain/puh-index";
import { type Governance, governance } from "./governance";
import { type LogHistoryStatus, checkLogHistory } from "./logs";
import { ConfigError, l1, network } from "./rpc";
import { quota } from "./safe-api";

// What the header, footer and every page's trust panel show: which chain the RPC is on, the
// pinned trust anchor, everything derived from it, and anything that should worry a signer.

/**
 * Background reads, for information: `index` is the ProtocolUpgradeHandler log index (deployment
 * to head). Lists wait for it, for a bounded time, or fail; they never answer from part of it.
 */
export type SyncStatus = { index: PuhIndexStatus };

export type AppStatus =
  | {
      ok: true;
      governance: Governance;
      logHistory: LogHistoryStatus;
      safeApi: { url: string | null; withKey: boolean; quota: typeof quota };
      l2RpcConfigured: boolean;
      clientVersion: string;
      sync: SyncStatus;
    }
  | { ok: false; error: string; hint: string };

export async function appStatus(): Promise<AppStatus> {
  try {
    const [net, gov, logHistory] = await Promise.all([network(), governance(), logHistoryStatus()]);
    return {
      ok: true,
      governance: gov,
      logHistory,
      safeApi: { url: net.safeTxServiceUrl, withKey: !!env.SAFE_API_KEY, quota: { ...quota } },
      l2RpcConfigured: net.l2RpcUrl !== null,
      clientVersion: net.clientVersion,
      sync: { index: puhIndex().status() },
    };
  } catch (error) {
    if (error instanceof ConfigError) {
      return {
        ok: false,
        error: error.message,
        hint: "Check the environment variables in the README.",
      };
    }
    return {
      ok: false,
      error: error instanceof Error ? error.message.split("\n")[0] ?? String(error) : String(error),
      hint: "The app could not read the governance contracts through L1_RPC_URL. Check the URL and that it points to Ethereum mainnet or Sepolia.",
    };
  }
}

// How much each outcome should worry a signer: a known log missing is the strongest signal that
// lists can be incomplete, then a failed check.
const SEVERITY: Record<LogHistoryStatus["status"], number> = {
  ok: 0,
  unchecked: 1,
  error: 2,
  missing: 3,
};

/**
 * The worse of two views of the RPC's log history: the standalone canary query, and (once the
 * ProtocolUpgradeHandler's log index is complete) whether the index holds the canary too.
 */
export async function logHistoryStatus(): Promise<LogHistoryStatus> {
  const [canary, indexed] = await Promise.all([checkLogHistory(l1), indexedCanary()]);
  return indexed && SEVERITY[indexed.status] > SEVERITY[canary.status] ? indexed : canary;
}

/**
 * The canary in the log index: null (no opinion) until the index is ready, without a canary to
 * check, or when the index cannot be read right now (e.g. the settings just changed).
 */
async function indexedCanary(): Promise<LogHistoryStatus | null> {
  const index = puhIndex();
  if (index.status().state !== "ready") return null;
  const [net, present] = await Promise.all([network(), index.hasCanary().catch(() => null)]);
  if (present === null || !net.logCanary) return null;
  return present
    ? { status: "ok" }
    : { status: "missing", blockNumber: net.logCanary.blockNumber.toString() };
}
