import { vitePlugin as remix } from "@remix-run/dev";
import { flatRoutes } from "remix-flat-routes";
import { remixRoutes } from "remix-routes/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  build: {
    cssMinify: process.env.NODE_ENV === "production",
  },
  plugins: [
    remix({
      // Scan route dependencies before serving pages, rather than rebuilding the
      // browser's dependency graph as someone navigates to a new route.
      future: { unstable_optimizeDeps: true },
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
