import { env } from "@config/env.server";
import { type Governance, governance } from "./governance";
import { type LogHistoryStatus, checkLogHistory } from "./logs";
import { ConfigError, l1, network } from "./rpc";
import { quota } from "./safe-api";

// What the header, footer and every page's trust panel show: which chain the RPC is on, the
// pinned trust anchor, everything derived from it, and anything that should worry a signer.

export type AppStatus =
  | {
      ok: true;
      governance: Governance;
      logHistory: LogHistoryStatus;
      safeApi: { url: string | null; withKey: boolean; quota: typeof quota };
      l2RpcConfigured: boolean;
      clientVersion: string;
    }
  | { ok: false; error: string; hint: string };

export async function appStatus(): Promise<AppStatus> {
  try {
    const [net, gov, logHistory] = await Promise.all([
      network(),
      governance(),
      checkLogHistory(l1),
    ]);
    return {
      ok: true,
      governance: gov,
      logHistory,
      safeApi: { url: net.safeTxServiceUrl, withKey: !!env.SAFE_API_KEY, quota: { ...quota } },
      l2RpcConfigured: net.l2RpcUrl !== null,
      clientVersion: net.clientVersion,
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
