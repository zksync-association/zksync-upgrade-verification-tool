import { type Server, createServer } from "node:http";

// A stand-in for Safe{Wallet}: a page that opens the app in an iframe and answers the Safe Apps
// SDK's postMessage calls the way Safe{Wallet} does. Requests are recorded in
// `window.__safeRequests`, and `window.__frameLoaded` turns true once the iframe has loaded (or
// failed to). Signing and sending only return ids; chain reads go to the fork.
//   GET /?safe=<member Safe>&path=<app path>
export function startSafeShell({
  port,
  appUrl,
  rpcUrl,
}: { port: number; appUrl: string; rpcUrl: string }) {
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
    const safe = url.searchParams.get("safe") ?? "";
    const path = url.searchParams.get("path") ?? "/";
    res.setHeader("content-type", "text/html");
    res.end(page({ appSrc: `${appUrl}${path}`, safe, rpcUrl }));
  });
  return new Promise<{ url: string; close: () => Promise<void> }>((resolve) => {
    server.listen(port, "127.0.0.1", () =>
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((done) => server.close(() => done())),
      })
    );
  });
}

function page({ appSrc, safe, rpcUrl }: { appSrc: string; safe: string; rpcUrl: string }) {
  return `<!doctype html>
<html><body style="margin:0">
<iframe id="app" src="${appSrc}" style="width:1280px;height:900px;border:0"
  onload="window.__frameLoaded = true"></iframe>
<script>
  window.__safeRequests = [];
  const frame = document.getElementById("app");
  const safeAddress = ${JSON.stringify(safe)};
  async function answer(method, params) {
    switch (method) {
      case "getSafeInfo":
        return { safeAddress, chainId: 1, threshold: 1, owners: [], isReadOnly: false };
      case "signTypedMessage":
        return { messageHash: "0x" + "11".repeat(32) };
      case "sendTransactions":
        return { safeTxHash: "0x" + "22".repeat(32) };
      case "rpcCall": {
        const response = await fetch(${JSON.stringify(rpcUrl)}, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: params.call, params: params.params }),
        }).then((r) => r.json());
        if (response.error) throw new Error(response.error.message);
        return response.result;
      }
      default:
        throw new Error("not supported by the test shell: " + method);
    }
  }
  window.addEventListener("message", async (event) => {
    if (event.source !== frame.contentWindow || !event.data || !event.data.method) return;
    const { id, method, params } = event.data;
    window.__safeRequests.push({ method, params });
    try {
      const data = await answer(method, params);
      event.source.postMessage({ id, success: true, version: "9.1.0", data }, "*");
    } catch (error) {
      event.source.postMessage({ id, success: false, version: "9.1.0", error: String(error) }, "*");
    }
  });
</script>
</body></html>`;
}

declare global {
  interface Window {
    __safeRequests: { method: string; params: unknown }[];
    __frameLoaded?: boolean;
  }
}
