import { env } from "@config/env.server";
import { type LocalSettings, saveLocalSettings } from "@config/local-settings.server";
import { createPublicClient, http } from "viem";
import { clearCache } from "./cache";
import { resetLogCaches } from "./logs";
import { resetRpcClients } from "./rpc";
import { resetSafeClient } from "./safe-api";

const loopback = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
export function requireLocalSettings(request: Request) {
  const url = new URL(request.url);
  if (!loopback.has(env.SERVER_HOST) || !loopback.has(url.hostname))
    throw new Response("Settings are available only on a local server.", { status: 403 });
  if (request.method !== "GET" && request.headers.get("Origin") !== url.origin)
    throw new Response("Settings must be changed from this site's origin.", { status: 403 });
}

// The saved values, for the settings page only (loopback, never cached): it shows each one hidden
// until its owner presses Show. The file build's `.invalid` placeholder counts as nothing saved.
export function settingsSummary() {
  const url = (value: string | undefined) =>
    value && !new URL(value).hostname.endsWith(".invalid") ? value : null;
  return {
    l1Rpc: url(env.L1_RPC_URL),
    l2Rpc: url(env.L2_RPC_URL),
    safeKey: env.SAFE_API_KEY || null,
    wcProjectId: env.WALLET_CONNECT_PROJECT_ID || null,
  };
}

export async function updateSettings(form: FormData) {
  const next: LocalSettings = {};
  const read = (name: string) => String(form.get(name) ?? "").trim();
  const l1 = read("l1Rpc");
  const l2 = read("l2Rpc");
  const key = read("safeKey");
  if (key.length > 8_192 || /[\r\n]/.test(key)) throw new Error("Enter a valid Safe API key.");
  if (key) next.SAFE_API_KEY = key;
  if (form.get("clearSafeKey") === "on") next.SAFE_API_KEY = null;
  if (l1) next.L1_RPC_URL = rpcUrl(l1);
  if (l2) next.L2_RPC_URL = rpcUrl(l2);
  if (form.get("clearL2Rpc") === "on") next.L2_RPC_URL = null;
  const projectId = read("wcProjectId");
  if (projectId && !/^[A-Za-z0-9]{16,64}$/.test(projectId))
    throw new Error("Enter a WalletConnect project id (letters and digits, as Reown shows it).");
  if (projectId) next.WALLET_CONNECT_PROJECT_ID = projectId;
  if (form.get("clearWcProjectId") === "on") next.WALLET_CONNECT_PROJECT_ID = null;

  try {
    const chain = await probeChain(next.L1_RPC_URL ?? env.L1_RPC_URL);
    if (chain !== 1 && chain !== 11155111)
      throw new Error("L1 RPC must use Ethereum Mainnet or Sepolia.");
    const l2Url = next.L2_RPC_URL === undefined ? env.L2_RPC_URL : next.L2_RPC_URL;
    if (l2Url) {
      const expected = chain === 1 ? 324 : 300;
      if ((await probeChain(l2Url)) !== expected)
        throw new Error(`L2 RPC must use ZKsync ${chain === 1 ? "Era Mainnet" : "Sepolia"}.`);
    }
  } catch (error) {
    if (error instanceof Error && /RPC must use/.test(error.message)) throw error;
    // Provider errors can contain the entire credential-bearing RPC URL.
    throw new Error("Could not connect to the RPC. Check its URL, credentials, and availability.");
  }
  saveLocalSettings(next);
  clearCache();
  resetLogCaches();
  resetRpcClients();
  resetSafeClient();
}

function rpcUrl(value: string) {
  try {
    const url = new URL(value);
    if (!["https:", "http:"].includes(url.protocol) || value.length > 4_096) throw new Error();
    return url.toString();
  } catch {
    throw new Error("RPC URLs must start with https:// or http://.");
  }
}

async function probeChain(url: string) {
  return createPublicClient({
    transport: http(url, { timeout: 8_000, retryCount: 0 }),
  }).getChainId();
}
