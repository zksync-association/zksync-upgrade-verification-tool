import esbuild from "esbuild";
import { nodeExternalsPlugin } from "esbuild-node-externals";

async function main() {
  const config = {
    entryPoints: ["./server/index.ts"],
    outdir: "./server-build",
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    logLevel: "info",
    plugins: [
      nodeExternalsPlugin({
        allowWorkspaces: true,
      }),
    ],
    external: ["vite", "../build/server/index.js"],
  } satisfies esbuild.BuildOptions;

  if (process.argv.includes("--watch")) {
    const ctx = await esbuild.context(config);
    await ctx.watch();
    return;
  }

  await esbuild.build(config);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
