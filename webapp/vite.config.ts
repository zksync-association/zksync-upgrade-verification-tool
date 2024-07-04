import { vitePlugin as remix } from "@remix-run/dev";
import { flatRoutes } from "remix-flat-routes";
import { remixRoutes } from "remix-routes/vite";
import { defineConfig } from "vite";
import { nodePolyfills } from "vite-plugin-node-polyfills";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  build: {
    cssMinify: process.env.NODE_ENV === "production",
    rollupOptions: {
      external: [/node:.*/, "stream", "crypto", "fsevents"],
    },
  },
  plugins: [
    nodePolyfills({
      include: ["buffer", "events", "http"],
      globals: {
        process: false
      }
    }),
    remix({
      ignoredRouteFiles: ["**/*"],
      serverModuleFormat: "esm",
      routes: (defineRoutes) => {
        return flatRoutes("routes", defineRoutes);
      },
    }),
    remixRoutes({
      outDir: ".",
    }),
    tsconfigPaths(),
  ],
});
