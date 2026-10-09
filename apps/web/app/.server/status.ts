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

// What the header, footer and every page's trust panel show: which chain the RPC is on, the
// pinned trust anchor, everything derived from it, and anything that should worry a signer.

/**
 * Background reads, for information: `index` is the ProtocolUpgradeHandler log index (deployment
 * to head). Lists wait for it, for a bounded time, or fail; they never answer from part of it.
 * `presence` says whether someone is using the app (a visible tab's beat, or a page load, within
 * SYNC_KEEPWARM_MS; JSON and this status never count) and how many keys are on screen. `engine`
 * is the sync engine, which follows the head and refreshes what requests read ahead of them (never
 * a source of answers of its own): with SYNC_MODE=window (the default) only while the app is in
 * use, so `engine.active` is false in a session that only reads JSON; with "always" for as long as
 * the server runs, doing less while nobody uses the app (`engine.cost.mode` "idle"). `safe` is the
 * Safe listing store's watcher, which while the app is in use asks Safe about the member Safes of
 * the open sets on screen whose signature is not valid yet (every SYNC_SAFE_WATCH_MS) and those
 * behind lists on screen (every SYNC_SAFE_LIST_WATCH_MS), within the quota; JSON still uses Safe
 * copies at most 60 s old. `l2` is the ZKsync Era timer (a read a minute while an Era page is on
 * screen).
 * `signatures` is the engine's precompute, at each new head, of the signature sets on screen;
 * results are the on-chain verdicts at that head, from Safe listings at most 60 s old. `l2Index`
 * is the ZKsync
 * Era governors' log index (ProposalCreated/Executed/Canceled of the pinned governors), which the
 * vetoable list, veto pages and startable upgrades read; idle with no governors when none is
 * indexed (no L2 RPC, or every governor replaced through env). `cache` is the local cache of
 * public chain and Safe data kept between runs (persist/chain-cache.ts): what was loaded at start
 * and whether this run's own reads have verified it; JSON never answers from it. `snapshot` is the
 * engine's last per-block snapshot (sync/snapshot.ts): what it read at its head, what was unknown
 * there, and how the provider answered the block guard; null before the first.
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

/**
 * What the app shell needs before anything else is read: which chain the RPC is on (the wallet
 * is set up for it, explorer links point at it). Public, from network() alone: no governance,
 * no verdict. In hand at once once network() has answered under the current settings (it is
 * read before the server starts listening, and kept); otherwise a promise of it.
 */
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

/**
 * The status. `freshness: "page"` (the app shell): governance at the head pages read
 * (governance.ts pageGovernance); JSON (/api/status) reads governance() as ever.
 */
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
