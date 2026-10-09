import { env } from "@config/env.server";
import { type L2IndexStatus, l2GovernorIndex } from "./chain/l2-index";
import { type PuhIndexStatus, puhIndex } from "./chain/puh-index";
import type { Governance } from "./governance";
import { governanceFor } from "./page-governance";
import { type LogHistoryStatus, checkLogHistory } from "./logs";
import { type ChainCacheStatus, chainCacheStatus } from "./persist/chain-cache";
import { ConfigError, type Network, l1, network, resolvedNetwork } from "./rpc";
import { type SafeStoreStatus, safeStoreStatus } from "./safe/store";
import { quota } from "./safe-api";
import { type SignatureSetsStatus, signatureSetsStatus } from "./signatures";
import { type SyncEngineStatus, syncEngineStatus } from "./sync/engine";
import { type EraWatchStatus, eraWatchStatus } from "./sync/era";
import { type SnapshotStatus, snapshotStatus } from "./sync/snapshot";
import { type PresenceStatus, presence } from "./sync/presence";

// What the header, footer and trust panels show: the chain, the pinned trust anchor and what is
// derived from it, and anything that should worry a signer.

/**
 * Background work, for information. The checks that count are governance.warnings,
 * network.overrides, logHistory and a cache.state of "mismatch".
 */
export type SyncStatus = {
  index: PuhIndexStatus;
  l2Index: L2IndexStatus;
  presence: PresenceStatus;
  engine: SyncEngineStatus;
  safe: SafeStoreStatus;
  signatures: SignatureSetsStatus;
  cache: ChainCacheStatus;
  snapshot: SnapshotStatus | null;
  l2: EraWatchStatus;
};

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

/** The chain the RPC is on, from network() alone: no governance, no verdict. */
export type ShellChain = Pick<
  Network,
  "chainId" | "label" | "isDevNode" | "explorerUrl" | "l2ExplorerUrl"
>;

export function shellChain(): ShellChain | Promise<ShellChain> {
  const chain = ({ chainId, label, isDevNode, explorerUrl, l2ExplorerUrl }: Network) => ({
    chainId,
    label,
    isDevNode,
    explorerUrl,
    l2ExplorerUrl,
  });
  const known = resolvedNetwork();
  return known ? chain(known) : network().then(chain);
}

/** `freshness: "page"` (the app shell) reads governance at the head pages read. */
export async function appStatus({
  freshness = "strict",
}: { freshness?: "strict" | "page" } = {}): Promise<AppStatus> {
  try {
    const [net, gov, logHistory] = await Promise.all([
      network(),
      governanceFor(freshness),
      logHistoryStatus(),
    ]);
    return {
      ok: true,
      governance: gov,
      logHistory,
      safeApi: { url: net.safeTxServiceUrl, withKey: !!env.SAFE_API_KEY, quota: { ...quota } },
      l2RpcConfigured: net.l2RpcUrl !== null,
      clientVersion: net.clientVersion,
      sync: {
        index: puhIndex().status(),
        l2Index: l2GovernorIndex().status(),
        presence: presence().status(),
        engine: syncEngineStatus(),
        safe: safeStoreStatus(),
        signatures: signatureSetsStatus(),
        cache: chainCacheStatus(),
        snapshot: snapshotStatus(),
        l2: eraWatchStatus(),
      },
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

// A known log missing is the strongest sign that lists may be incomplete.
const SEVERITY: Record<LogHistoryStatus["status"], number> = {
  ok: 0,
  unchecked: 1,
  error: 2,
  missing: 3,
};

/** The worse of the canary query and, once the index is complete, the index's own canary. */
export async function logHistoryStatus(): Promise<LogHistoryStatus> {
  const [canary, indexed] = await Promise.all([checkLogHistory(l1), indexedCanary()]);
  return indexed && SEVERITY[indexed.status] > SEVERITY[canary.status] ? indexed : canary;
}

async function indexedCanary(): Promise<LogHistoryStatus | null> {
  const index = puhIndex();
  if (index.status().state !== "ready") return null;
  const [net, present] = await Promise.all([network(), index.hasCanary().catch(() => null)]);
  if (present === null || !net.logCanary) return null;
  return present
    ? { status: "ok" }
    : { status: "missing", blockNumber: net.logCanary.blockNumber.toString() };
}
