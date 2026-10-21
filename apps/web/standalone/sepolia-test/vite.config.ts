import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Alias, Plugin, UserConfig } from "vite";
import base from "../vite.config";

// The single file for the governance contracts deployed on Sepolia to test with (README.md): the
// same app, with Sepolia's trust anchors replaced by deployment.json's (or SEPOLIA_TEST_DEPLOYMENT's)
// and keys of its own in the browser. Then inline.mjs makes dist/verifier-sepolia-test.html.
const at = (path: string) => fileURLToPath(new URL(path, import.meta.url));
const deployment = JSON.parse(
  readFileSync(at(process.env.SEPOLIA_TEST_DEPLOYMENT ?? "./deployment.json"), "utf8")
);

const title: Plugin = {
  name: "sepolia-test-title",
  transformIndexHtml: (html) => html.replace("</title>", " · Sepolia test deployment</title>"),
};

const config: UserConfig = {
  ...base,
  plugins: [...(base.plugins ?? []), title],
  define: { ...base.define, __SEPOLIA_TEST_DEPLOYMENT__: JSON.stringify(deployment) },
  resolve: {
    ...base.resolve,
    alias: [
      { find: /^@\/common\/networks$/, replacement: at("./networks.ts") },
      { find: /^@\/common\/storage-prefix$/, replacement: at("./storage-prefix.ts") },
      ...(base.resolve?.alias as Alias[]),
    ],
  },
  build: { ...base.build, outDir: at("./dist") },
};
export default config;
