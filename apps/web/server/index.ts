import { createRequestHandler } from "@remix-run/express";
import type { ServerBuild } from "@remix-run/node";
import { ip as ipAddress } from "address";
import chalk from "chalk";
import closeWithGrace from "close-with-grace";
import compression from "compression";
import express, { type RequestHandler, type Request, type Response } from "express";
import getPort, { portNumbers } from "get-port";

import { env, safeWalletOrigins } from "@config/env.server";
import { cspNonce } from "@server/middlewares/csp-nonce";
import { patchBigintToJSON } from "@server/utils/bigint";
import { logger } from "./middlewares/logger";
import { rateLimit } from "./middlewares/rate-limit";
import { removeTrailingSlash } from "./middlewares/remove-trailing-slash";
import { requireHttps } from "./middlewares/require-https";
import { safeAppHeaders, safeAppManifest } from "./middlewares/safe-app";

patchBigintToJSON();

const viteDevServer =
  env.NODE_ENV === "production"
    ? undefined
    : await import("vite").then((vite) =>
        vite.createServer({
          server: { middlewareMode: true },
        })
      );

const app = express();

app.set("trust proxy", true);

app.use(requireHttps);
app.use(safeAppHeaders(safeWalletOrigins));
app.get("*", removeTrailingSlash);
app.use(compression());

// http://expressjs.com/en/advanced/best-practice-security.html#at-a-minimum-disable-x-powered-by-header
app.disable("x-powered-by");

if (viteDevServer) {
  app.use(viteDevServer.middlewares);
} else {
  // Remix fingerprints its assets so we can cache forever.
  app.use("/assets", express.static("build/client/assets", { immutable: true, maxAge: "1y" }));

  // Everything else (like favicon.ico) is cached for an hour. You may want to be
  // more aggressive with this caching.
  app.use(express.static("build/client", { maxAge: "1h" }));
}

app.get("/manifest.json", (_req, res) => {
  res.json(safeAppManifest);
});

app.get(["/img/*", "/favicons/*"], (_req, res) => {
  // if we made it past the express.static for these, then we're missing something.
  // So we'll just send a 404 and won't bother calling other middleware.
  return res.status(404).send("Not found");
});

app.use(logger);
app.use(cspNonce);
app.use(rateLimit);

if (!env.ALLOW_INDEXING) {
  app.use((_, res, next) => {
    res.set("X-Robots-Tag", "noindex, nofollow");
    next();
  });
}

async function getBuild() {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const build = viteDevServer
    ? () => viteDevServer.ssrLoadModule("virtual:remix/server-build")
    : // @ts-ignore-error  this should exist before running the server
      await import("../build/server/index.js");
  return build as unknown as ServerBuild;
}

// What the app build's entry module exports for the server (app/entry.server.tsx).
type AppEntry = {
  prewarm?: (reason: "boot") => Promise<void>;
  startSync?: () => void;
  touchSync?: () => void;
};

let productionEntry: Promise<AppEntry> | undefined;

/** The app build's entry module: one for the process in production; Vite's current one in dev. */
function appEntry(): Promise<AppEntry> {
  if (productionEntry) return productionEntry;
  const loading = (async () => {
    // A module in production; in development a function that loads it from Vite.
    const build = (await getBuild()) as ServerBuild | (() => Promise<ServerBuild>);
    const { entry } = typeof build === "function" ? await build() : build;
    return entry.module as AppEntry;
  })();
  if (!viteDevServer) {
    productionEntry = loading;
    loading.catch(() => {
      if (productionEntry === loading) productionEntry = undefined;
    });
  }
  return loading;
}

// Every request that reaches the app (pages, /api/*, resources; not static files) is activity
// for the sync engine, which follows the chain only while the app is in use (SYNC_MODE,
// SYNC_KEEPWARM_MS). The request itself never waits on it.
app.use((_req, _res, next) => {
  appEntry().then(
    (entry) => entry.touchSync?.(),
    () => {}
  );
  next();
});

app.all(
  "*",
  createRequestHandler({
    getLoadContext: (_req: Request, res: Response) => ({
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      cspNonce: res.locals.cspNonce,
      serverBuild: getBuild(),
    }),
    mode: env.NODE_ENV,
    build: await getBuild(),
  }) as RequestHandler
);

const desiredPort = env.SERVER_PORT;
const portToUse = await getPort({
  port: portNumbers(desiredPort, desiredPort + 100),
});
const portAvailable = desiredPort === portToUse;
if (!portAvailable && env.NODE_ENV !== "development") {
  console.log(`⚠️ Port ${desiredPort} is not available.`);
  process.exit(1);
}

// Fail fast with a readable message instead of on the first page load.
async function checkRpc() {
  const response = await fetch(env.L1_RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
  });
  const body = (await response.json()) as { result?: string; error?: { message: string } };
  if (!body.result)
    throw new Error(`L1_RPC_URL answered eth_chainId with ${JSON.stringify(body.error ?? body)}`);
  const chainId = Number(body.result);
  const known = chainId === 1 ? "Ethereum mainnet" : chainId === 11155111 ? "Sepolia" : null;
  if (!known && !env.UPGRADE_HANDLER_ADDRESS) {
    throw new Error(
      `L1_RPC_URL is on chain ${chainId}. Use a mainnet or Sepolia RPC, or set UPGRADE_HANDLER_ADDRESS.`
    );
  }
  return known ?? `chain ${chainId}`;
}

// Warms the caches a first page needs (network, governance, the handler's log index, Safe
// listings) through the app build's own modules, so requests share them, and starts the sync
// engine. PREWARM=0 turns the warm-up off (the build's prewarm() checks), SYNC_MODE=off the
// engine. Logs step names and timings only, and never stops the server.
async function prewarmApp() {
  try {
    const { prewarm, startSync } = await appEntry();
    startSync?.();
    await prewarm?.("boot");
  } catch {
    console.warn("Start-up warm-up skipped; pages read everything on first use.");
  }
}

async function startServer() {
  try {
    const chain = await checkRpc();
    console.log(`Reading governance from ${chain} through L1_RPC_URL.`);

    const server = app.listen(portToUse, env.SERVER_HOST, () => {
      if (!portAvailable) {
        console.warn(
          chalk.yellow(`⚠️  Port ${desiredPort} is not available, using ${portToUse} instead.`)
        );
      }
      console.log("🚀  We have liftoff!");
      const localUrl = `http://localhost:${portToUse}`;
      let lanUrl: string | null = null;
      const localIp = ipAddress() ?? "Unknown";
      if (
        env.SERVER_HOST === "0.0.0.0" &&
        /^10[.]|^172[.](1[6-9]|2[0-9]|3[0-1])[.]|^192[.]168[.]/.test(localIp)
      ) {
        lanUrl = `http://${localIp}:${portToUse}`;
      }

      console.log(
        [
          `${chalk.bold("Local:")}            ${chalk.cyan(localUrl)}`,
          lanUrl && `${chalk.bold("On Your Network:")}  ${chalk.cyan(lanUrl)}`,
          chalk.bold("Press Ctrl+C to stop"),
        ]
          .filter(Boolean)
          .join("\n")
      );
      void prewarmApp();
    });

    closeWithGrace(async () => {
      await new Promise((resolve, reject) => {
        server.close((e) => (e ? reject(e) : resolve("ok")));
      });
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}

startServer();
