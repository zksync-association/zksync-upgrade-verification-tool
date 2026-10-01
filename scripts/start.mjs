// `L1_RPC_URL=<your RPC URL> npm start`: installs the web app's dependencies, builds it and serves it.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

if (!process.env.L1_RPC_URL) {
  console.error(
    "Set L1_RPC_URL to your Ethereum mainnet or Sepolia RPC URL, for example:\n" +
      "  L1_RPC_URL=https://mainnet.gateway.tenderly.co npm start"
  );
  process.exit(1);
}
if (Number(process.versions.node.split(".")[0]) < 20) {
  console.error(`Node.js 20 or newer is required (this is ${process.version}).`);
  process.exit(1);
}

// pnpm at the version pinned in package.json: through corepack where Node ships it (up to
// Node 24), otherwise through npx.
const shell = process.platform === "win32";
const { packageManager } = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8")
);
const hasCorepack = spawnSync("corepack", ["--version"], { stdio: "ignore", shell }).status === 0;
const [command, ...prefix] = hasCorepack
  ? ["corepack", "pnpm"]
  : ["npx", "--yes", packageManager.split("+")[0]];

function pnpm(...args) {
  const { status } = spawnSync(command, [...prefix, ...args], {
    stdio: "inherit",
    shell,
    env: { ...process.env, COREPACK_ENABLE_DOWNLOAD_PROMPT: "0" },
  });
  if (status !== 0) process.exit(status ?? 1);
}

pnpm("install", "--frozen-lockfile", "--filter", "web...");
pnpm("--filter", "web", "build");
pnpm("--filter", "web", "start");
