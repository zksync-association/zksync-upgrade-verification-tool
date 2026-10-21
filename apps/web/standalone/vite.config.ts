import { fileURLToPath } from "node:url";
import type { UserConfig } from "vite";

// The whole site as one file (dist/verifier.html, after inline.mjs): no server, opened from disk.
const at = (path: string) => fileURLToPath(new URL(path, import.meta.url));
const shim = (find: string, file: string) => ({ find, replacement: at(`./shims/${file}`) });

const config: UserConfig = {
  root: at("."),
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: [
      shim("@config/env.server", "env.ts"),
      shim("@config/log.server", "log.ts"),
      shim("@config/local-settings.server", "local-settings.ts"),
      shim("@remix-run/react", "remix-react.tsx"),
      shim("@remix-run/node", "remix-node.ts"),
      shim("node:crypto", "crypto.ts"),
      shim("node:async_hooks", "async-hooks.ts"),
      shim("node:fs/promises", "fs.ts"),
      shim("node:path", "path.ts"),
      shim("@/fonts.css", "fonts.css"),
      { find: /^@config\//, replacement: `${at("../config")}/` },
      { find: /^@\//, replacement: `${at("../app")}/` },
    ],
  },
  build: {
    outDir: at("./dist"),
    emptyOutDir: true,
    target: "es2022",
    modulePreload: false,
    cssCodeSplit: false,
    assetsInlineLimit: 100_000_000,
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
};
export default config;
