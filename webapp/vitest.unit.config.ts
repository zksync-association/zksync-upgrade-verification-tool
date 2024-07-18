import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    environment: "happy-dom",
    setupFiles: ["app/test/setup.unit.ts"],
    include: ["app/test/unit/*.{test,spec}.{ts,tsx}"],
  },
});
