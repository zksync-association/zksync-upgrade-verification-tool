import { loadChainCache, saveChainCache } from "@/.server/persist/chain-cache";
import { prewarm, readNetwork } from "@/.server/prewarm";
import { startSync } from "@/.server/sync/engine";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider, createHashRouter } from "react-router-dom";
import { LOCAL, localRequest } from "./local-request";
import { installPolyfills } from "./polyfills";
import { pageEndpoints, routes } from "./routes";
import { hasRpcSetting } from "./shims/local-settings";

installPolyfills();

// The pages' beats and Fetch signatures POST to /resources/…: answered here, in the page.
const network = window.fetch.bind(window);
window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const path = url.startsWith("/") ? url.split("?")[0] : null;
  const endpoint = path ? pageEndpoints[path] : undefined;
  if (!endpoint) return network(input, init);
  const request = localRequest(new Request(`${LOCAL}${url}`, init), path ?? undefined);
  return (await endpoint({ request, params: {}, context: {} })) as Response;
};
const beacon = navigator.sendBeacon?.bind(navigator);
navigator.sendBeacon = (url: string | URL, data?: BodyInit | null) => {
  const href = String(url);
  if (!href.startsWith("/resources/")) return beacon ? beacon(url, data) : false;
  void window.fetch(href, {
    method: "POST",
    body: data ?? null,
    headers: { "content-type": "application/json" },
  });
  return true;
};

// WalletConnect's Verify step loads a hidden page from verify.walletconnect.org and waits up to 5 s
// for it to vouch for this page's address. A file has none (Verify answers 400), so nothing ever
// comes and pairing stalls for the full 5 s: end that wait at once. The wallet sees the connection
// as unverified either way.
if (location.protocol === "file:")
  new MutationObserver((records) => {
    for (const record of records)
      for (const node of record.addedNodes)
        if (
          node instanceof HTMLIFrameElement &&
          node.src.startsWith("https://verify.walletconnect.")
        )
          node.dispatchEvent(new Event("error"));
  }).observe(document.documentElement, { childList: true, subtree: true });

const within = (work: () => Promise<unknown>, ms: number) =>
  Promise.race([work().catch(() => {}), new Promise((resolve) => setTimeout(resolve, ms))]);

async function start() {
  if (hasRpcSetting()) {
    // As the server does before it listens: the last run's history, then the network in the
    // background, the engine (it follows the chain while this tab is visible) and the warm-up.
    await within(loadChainCache, 2_000);
    void within(readNetwork, 4_000);
    startSync();
    void prewarm("boot");
    addEventListener("pagehide", () => void saveChainCache());
  }
  const router = createHashRouter(routes);
  createRoot(document.getElementById("root") as HTMLElement).render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>
  );
}
void start();
