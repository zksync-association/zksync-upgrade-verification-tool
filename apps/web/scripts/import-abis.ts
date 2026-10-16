// Regenerates the function catalog the call decoder uses (app/common/abi-catalog/functions.json)
// from a folder of ABI files, and optionally the address labels (labels.json) from the data block of
// a transaction-simulator tx-viewer.html.
//
//   corepack pnpm exec tsx scripts/import-abis.ts --abi <dir> [--labels <tx-viewer.html>]
//
// An ABI file is a JSON array of ABI entries, or an artifact with an `abi` array. Files are read in
// name order and the first ABI that declares a signature keeps it, so the output does not depend on
// the file system. Only what decoding needs is kept: names, types, components, and the struct, enum
// or contract name of internalType.
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

type AbiParam = { name?: string; type: string; internalType?: string; components?: AbiParam[] };
type AbiEntry = { type?: string; name?: string; inputs?: AbiParam[] };
type CatalogParam = {
  name: string;
  type: string;
  internalType?: string;
  components?: CatalogParam[];
};

const OUT = fileURLToPath(new URL("../app/common/abi-catalog", import.meta.url));

function arg(name: string) {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
}

const canonical = (p: AbiParam): string =>
  p.type.startsWith("tuple")
    ? `(${(p.components ?? []).map(canonical).join(",")})${p.type.slice("tuple".length)}`
    : p.type;

function strip(p: AbiParam): CatalogParam {
  const out: CatalogParam = { name: p.name ?? "", type: p.type };
  if (p.internalType && /^(struct|enum|contract) /.test(p.internalType))
    out.internalType = p.internalType;
  if (p.components) out.components = p.components.map(strip);
  return out;
}

function functions(dir: string) {
  const seen = new Set<string>();
  const out: { type: "function"; name: string; inputs: CatalogParam[]; abi: string }[] = [];
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort();
  for (const file of files) {
    const json = JSON.parse(readFileSync(join(dir, file), "utf8"));
    const abi: AbiEntry[] = Array.isArray(json) ? json : Array.isArray(json?.abi) ? json.abi : [];
    for (const entry of abi) {
      if (entry.type !== "function" || !entry.name) continue;
      const inputs = entry.inputs ?? [];
      const signature = `${entry.name}(${inputs.map(canonical).join(",")})`;
      if (seen.has(signature)) continue;
      seen.add(signature);
      out.push({
        type: "function",
        name: entry.name,
        inputs: inputs.map(strip),
        abi: basename(file, ".json"),
      });
    }
  }
  return { out, files: files.length };
}

// The tx-viewer keys its labels by network name; this app keys them by chain id.
function labels(html: string) {
  const block = /<script id="tx-viewer-data" type="application\/json">([\s\S]*?)<\/script>/.exec(
    html
  );
  if (!block?.[1]) throw new Error("No tx-viewer-data block in the labels file");
  const data = JSON.parse(block[1]) as {
    networks: Record<string, { chainId: string }>;
    labels: Record<string, Record<string, string>>;
  };
  const out: Record<string, Record<string, string>> = {};
  for (const [network, byAddress] of Object.entries(data.labels)) {
    const chainId = data.networks[network]?.chainId;
    if (!chainId) continue;
    out[chainId] = Object.fromEntries(
      Object.entries(byAddress)
        .map(([address, label]) => [address.toLowerCase(), label] as const)
        .sort(([a], [b]) => a.localeCompare(b))
    );
  }
  return out;
}

const abiDir = arg("--abi");
if (!abiDir) {
  console.error("Usage: tsx scripts/import-abis.ts --abi <dir> [--labels <tx-viewer.html>]");
  process.exit(1);
}
const { out, files } = functions(abiDir);
writeFileSync(join(OUT, "functions.json"), `${JSON.stringify(out)}\n`);
console.log(`functions.json: ${out.length} functions from ${files} ABI files`);
const labelsFile = arg("--labels");
if (labelsFile) {
  const byChain = labels(readFileSync(labelsFile, "utf8"));
  writeFileSync(join(OUT, "labels.json"), `${JSON.stringify(byChain, null, 1)}\n`);
  const count = Object.values(byChain).reduce((n, l) => n + Object.keys(l).length, 0);
  console.log(`labels.json: ${count} labels on chains ${Object.keys(byChain).join(", ")}`);
}
