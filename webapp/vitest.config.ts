import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    environment: "happy-dom",
    setupFiles: ["./test/setup.unit.ts"],
    include: ["**/app/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["**/app/**/e2e/*.{test,spec}.{ts,tsx}"],
  },
});
