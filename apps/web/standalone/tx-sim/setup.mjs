// Stage local browser dependencies and the built verifier without a CDN.
import { copyFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
copyFileSync(
  require.resolve("ethers/dist/ethers.umd.min.js"),
  new URL("./ethers.umd.min.js", import.meta.url)
);
const verifier = new URL("../ecosystems/dist-testnet-3/verifier-testnet-3.html", import.meta.url);
if (!existsSync(verifier))
  throw new Error("Build the Testnet 3 standalone verifier first (README.md).");
copyFileSync(verifier, new URL("./index.html", import.meta.url));
