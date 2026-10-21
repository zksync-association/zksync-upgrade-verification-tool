import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Alias, Plugin, UserConfig } from "vite";
import base from "../vite.config";

// The single file for another ZKsync ecosystem's governance (README.md): the same app, with its L1
// chain's trust anchors, L2 and contract names from <ECOSYSTEM>.json, and keys of its own in the
// browser. Then inline.mjs makes dist-<ECOSYSTEM>/verifier-<ECOSYSTEM>.html.
const at = (path: string) => fileURLToPath(new URL(path, import.meta.url));
const name = process.env.ECOSYSTEM;
if (!name || !/^[a-z0-9-]+$/.test(name)) throw new Error("Set ECOSYSTEM to a config's name");
const ecosystem = JSON.parse(readFileSync(at(`./${name}.json`), "utf8"));

const title: Plugin = {
  name: "ecosystem-title",
  transformIndexHtml: (html) => html.replace("</title>", ` · ${ecosystem.name}</title>`),
};

const config: UserConfig = {
  ...base,
  plugins: [...(base.plugins ?? []), title],
  define: { ...base.define, __ECOSYSTEM__: JSON.stringify(ecosystem) },
  resolve: {
    ...base.resolve,
    alias: [
      { find: /^@\/common\/networks$/, replacement: at("./networks.ts") },
      { find: /^@\/common\/storage-prefix$/, replacement: at("./storage-prefix.ts") },
      ...(base.resolve?.alias as Alias[]),
    ],
  },
  build: { ...base.build, outDir: at(`./dist-${name}`) },
};
export default config;
