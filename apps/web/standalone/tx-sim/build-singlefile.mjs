// Fetch through gh at build time; no server, GitHub credential, CDN script or
// separate ABI/JSON asset is needed when the signer opens the resulting HTML.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { createHash } from "node:crypto";
import { build } from "esbuild";
import { ethers } from "ethers";
import { contracts } from "./tx-sim-contracts.mjs";
import { preparedProposals, votingRetry } from "./tx-sim-source.mjs";
import { ADDRESSES } from "./tx-sim-config.mjs";
import { requireThat, same } from "./tx-sim-core.mjs";

const root = fileURLToPath(new URL("./", import.meta.url));
const { values } = parseArgs({
  options: {
    snapshot: { type: "string" },
    pr: { type: "string", default: "386" },
    output: { type: "string", default: "tx-sim-testnet-3.html" },
    "retry-description": { type: "string" },
    "proposal-id": { type: "string" },
  },
});
const scratch = mkdtempSync(join(tmpdir(), "tx-sim-html-"));
try {
  if (!values.snapshot)
    execFileSync(
      "python3",
      [join(root, "prepare-tx-sim.py"), "--output", scratch, "--pr", values.pr],
      {
        stdio: "inherit",
      }
    );
  const snapshot = JSON.parse(
    readFileSync(
      values.snapshot ? resolve(values.snapshot) : join(scratch, "tx-sim-package.json"),
      "utf8"
    )
  );
  const abis = JSON.parse(
    readFileSync(
      values.snapshot ? join(root, "tx-sim-abis.json") : join(scratch, "tx-sim-abis.json"),
      "utf8"
    )
  );
  const c = contracts(abis, ethers);
  const proposals = await preparedProposals(snapshot, c);
  let prepared = null;
  if (values["retry-description"]) {
    const choices = values["proposal-id"]
      ? proposals.filter((_vote) => BigInt(_vote.proposalId) === BigInt(values["proposal-id"]))
      : proposals;
    if (choices.length !== 1)
      throw new Error(
        "Choose one prepared proposal with --proposal-id before building its voting retry."
      );
    requireThat(
      same(choices[0].from, ADDRESSES.control),
      "The prepared retry workflow must use the source's required Testnet 3 voting account."
    );
    prepared = votingRetry(choices[0], values["retry-description"], c);
  }
  const result = await build({
    entryPoints: [join(root, "singlefile-entry.mjs")],
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    target: "es2022",
    minify: true,
    legalComments: "none",
    define: { "process.env.NODE_ENV": '"production"', global: "globalThis" },
    logLevel: "warning",
  });
  const data = JSON.stringify({ snapshot, abis, prepared }).replaceAll("<", "\\u003c");
  const script = result.outputFiles[0].text.replaceAll(/<\/script/gi, "<\\/script");
  const html = readFileSync(join(root, "tx-sim.html"), "utf8")
    .replace(
      '<link rel="stylesheet" href="tx-sim.css" />',
      () => `<style>${readFileSync(join(root, "tx-sim.css"), "utf8")}</style>`
    )
    .replace(
      '<script src="ethers.umd.min.js"></script>',
      () => `<script>window.__TX_SIM_BOOTSTRAP__=${data};</script>`
    )
    .replace('<script type="module" src="tx-sim-ui.mjs"></script>', "")
    .replace("</body>", () => `<script>${script}</script></body>`);
  if (/<(?:script|link)\b[^>]*(?:src|href)=/i.test(html))
    throw new Error("A script or stylesheet was left outside the HTML.");
  const output = resolve(values.output);
  writeFileSync(output, html);
  const manifest = {
    repo: snapshot.repo,
    pr: snapshot.number,
    commit: snapshot.commit,
    pinnedAt: snapshot.pinnedAt,
    htmlSha256: createHash("sha256").update(html).digest("hex"),
    preparedProposal: prepared
      ? {
          proposalId: BigInt(prepared.proposalId).toString(),
          retryOf: BigInt(prepared.retryOf).toString(),
          upgradeId: prepared.upgradeId,
          source: prepared.source,
          description: prepared.description,
          originalDescription: prepared.originalDescription,
          messageUnchanged: true,
        }
      : null,
  };
  writeFileSync(`${output}.build.json`, `${JSON.stringify(manifest, null, 2)}\n`);
  if (prepared)
    writeFileSync(
      `${output}.proposal.json`,
      `${JSON.stringify({ payload: prepared.payload, description: prepared.description, ...manifest.preparedProposal }, null, 2)}\n`
    );
  console.log(JSON.stringify({ output, bytes: Buffer.byteLength(html), ...manifest }, null, 2));
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
