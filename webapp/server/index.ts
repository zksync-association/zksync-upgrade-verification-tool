import { createRequestHandler } from "@remix-run/express";
import { type ServerBuild, installGlobals } from "@remix-run/node";
import { ip as ipAddress } from "address";
import chalk from "chalk";
import closeWithGrace from "close-with-grace";
import compression from "compression";
import express, { type RequestHandler, type Request, type Response } from "express";
import getPort, { portNumbers } from "get-port";

import { cspNonce } from "@server/middlewares/csp-nonce";
import { env } from "../config/env.server";
import { helmet } from "./middlewares/helmet";
import { logger } from "./middlewares/logger";
import { rateLimit } from "./middlewares/rate-limit";
import { removeTrailingSlash } from "./middlewares/remove-trailing-slash";
import { requireHttps } from "./middlewares/require-https";

installGlobals();

const viteDevServer =
  env.NODE_ENV === "production"
    ? undefined
    : await import("vite").then((vite) =>
        vite.createServer({
          server: { middlewareMode: true },
        })
      );

const app = express();

// Fly.io requires the app to trust the proxy
app.set("trust proxy", true);

app.use(requireHttps);
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

app.get(["/img/*", "/favicons/*"], (_req, res) => {
  // if we made it past the express.static for these, then we're missing something.
  // So we'll just send a 404 and won't bother calling other middleware.
  return res.status(404).send("Not found");
});

app.use(logger);
app.use(cspNonce);
app.use(helmet());
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

const server = app.listen(portToUse, () => {
  if (!portAvailable) {
    console.warn(
      chalk.yellow(`⚠️  Port ${desiredPort} is not available, using ${portToUse} instead.`)
    );
  }
  console.log("🚀  We have liftoff!");
  const localUrl = `http://localhost:${portToUse}`;
  let lanUrl: string | null = null;
  const localIp = ipAddress() ?? "Unknown";
  // Check if the address is a private ip
  // https://en.wikipedia.org/wiki/Private_network#Private_IPv4_address_spaces
  // https://github.com/facebook/create-react-app/blob/d960b9e38c062584ff6cfb1a70e1512509a966e7/packages/react-dev-utils/WebpackDevServerUtils.js#LL48C9-L54C10
  if (/^10[.]|^172[.](1[6-9]|2[0-9]|3[0-1])[.]|^192[.]168[.]/.test(localIp)) {
    lanUrl = `http://${localIp}:${portToUse}`;
  }

  console.log(
    `
${chalk.bold("Local:")}            ${chalk.cyan(localUrl)}
${lanUrl ? `${chalk.bold("On Your Network:")}  ${chalk.cyan(lanUrl)}` : ""}
${chalk.bold("Press Ctrl+C to stop")}
		`.trim()
  );
});

closeWithGrace(async () => {
  await new Promise((resolve, reject) => {
    server.close((e) => (e ? reject(e) : resolve("ok")));
  });
});
