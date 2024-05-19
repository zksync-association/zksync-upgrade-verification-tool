import fs from "node:fs/promises";
import path from "node:path";
import type {
  CryptoJson,
  FacetCutsJson,
  FacetsJson,
  L2UpgradeJson,
  TransactionsJson,
  UpgradeManifest,
} from "../schema";
import { SCHEMAS } from "./parser";
import type { Network } from "./constants";
import { MissingNetwork, NotADir, NotAnUpgradeDir } from "./errors.js";
import { assertDirectoryExists, directoryExists } from "./fs-utils.js";

export type UpgradeDescriptor = {
  commonData: UpgradeManifest;
  transactions: TransactionsJson;
  crypto: CryptoJson;
  facetCuts?: FacetCutsJson;
  facets?: FacetsJson;
  l2Upgrade?: L2UpgradeJson;
};

function possibleDirNamesFor(n: Network): string[] {
  if (n === "mainnet") {
    return ["mainnet", "mainnet2"];
  }
  if (n === "sepolia") {
    return ["testnet-sepolia", "testnet"];
  }
  throw new Error(`Unknown network: ${n}`);
}

export const lookupAndParse = async (
  upgradeDirectory: string,
  network: Network
): Promise<UpgradeDescriptor> => {
  const targetDir = path.resolve(process.cwd(), upgradeDirectory);
  const possibleNetworkDirs = possibleDirNamesFor(network);

  await assertDirectoryExists(targetDir, upgradeDirectory);

  const commonPath = path.join(targetDir, "common.json");

  const commonBuf = await fs.readFile(commonPath).catch((e) => {
    if (e instanceof Error && e.message.includes("no such file or directory")) {
      throw new NotAnUpgradeDir(upgradeDirectory);
    }
    throw e;
  });

  const commonParser = SCHEMAS["common.json"];
  const commonData = commonParser.parse(JSON.parse(commonBuf.toString()));

  let networkDir: string | undefined
  for (const name of possibleNetworkDirs) {
    if (await directoryExists(path.join(targetDir, name))) {
      networkDir = name
    }
  }

  if (!networkDir) {
    throw new MissingNetwork(upgradeDirectory, network);
  }

  const transactionsPath = path.join(targetDir, networkDir, "transactions.json");
  const transactionsBuf = await fs.readFile(transactionsPath);
  const transactions = SCHEMAS["transactions.json"].parse(JSON.parse(transactionsBuf.toString()));

  const cryptoPath = path.join(targetDir, networkDir, "crypto.json");
  const cryptoBuf = await fs.readFile(cryptoPath);
  const crypto = SCHEMAS["crypto.json"].parse(JSON.parse(cryptoBuf.toString()));

  const facetCutsPath = path.join(targetDir, networkDir, "facetCuts.json");
  let facetCuts: FacetCutsJson | undefined;
  try {
    const facetCutsBuf = await fs.readFile(facetCutsPath);
    facetCuts = SCHEMAS["facetCuts.json"].parse(JSON.parse(facetCutsBuf.toString()));
  } catch (e) {
    facetCuts = undefined;
  }
  const facetsPath = path.join(targetDir, networkDir, "facets.json");
  let facets: FacetsJson | undefined;
  try {
    const facetCutsBuf = await fs.readFile(facetsPath);
    facets = SCHEMAS["facets.json"].parse(JSON.parse(facetCutsBuf.toString()));
  } catch (e) {
    facets = undefined;
  }

  const l2UpgradePath = path.join(targetDir, networkDir, "l2Upgrade.json");
  let l2Upgrade: L2UpgradeJson | undefined;
  try {
    const l2UpgradeBuf = await fs.readFile(l2UpgradePath);
    l2Upgrade = SCHEMAS["l2Upgrade.json"].parse(JSON.parse(l2UpgradeBuf.toString()));
  } catch (e) {
    l2Upgrade = undefined;
  }

  return {
    commonData,
    transactions,
    crypto,
    facetCuts,
    facets,
    l2Upgrade,
  };
};
