import fs from "node:fs/promises";
import path from "node:path";
import {
  commonJsonSchema,
  type CryptoJson,
  type FacetCutsJson,
  type FacetsJson,
  type L2UpgradeJson,
  type TransactionsJson,
  type UpgradeManifest,
} from "../schema";
import { ZodError } from "zod";
import { SCHEMAS } from "./parser";
import type { Network } from "./constants";

export const retrieveDirNames = async (targetDir: string) => {
  const items = await fs.readdir(targetDir, { withFileTypes: true });
  const directories = items.filter((dirent) => dirent.isDirectory()).map((dirent) => dirent.name);

  return await Promise.all(
    directories.map(async (dir) => ({
      name: dir,
      parsed: await isUpgradeBlob(path.join(targetDir, dir)),
    }))
  );
};

const isUpgradeBlob = async (
  filePath: string
): Promise<{ valid: boolean; parsed?: UpgradeManifest }> => {
  const items = await fs.readdir(filePath);
  const files = items.filter((file) => file === "common.json");

  if (files.length !== 1) {
    return { valid: false };
  }

  try {
    const commonJson = JSON.parse(await fs.readFile(`${filePath}/common.json`, "utf-8"));
    const parsed = commonJsonSchema.parse(commonJson);
    return { valid: true, parsed };
  } catch (e) {
    if (e instanceof ZodError) {
      process.env.DEBUG === "1" && console.error(e.message);
    } else {
      console.error(e);
    }
    // TODO: Add a logging system and add debug logs for parse failure
    return { valid: false };
  }
};

export type UpgradeDescriptor = {
  commonData: UpgradeManifest;
  transactions: TransactionsJson;
  crypto: CryptoJson;
  facetCuts?: FacetCutsJson;
  facets?: FacetsJson;
  l2Upgrade?: L2UpgradeJson;
};

function translateNetwork(n: Network) {
  if (n === "mainnet") {
    return "mainnet2";
  }
  if (n === "sepolia") {
    return "testnet-sepolia";
  }
  throw new Error(`Unknown network: ${n}`);
}

export const lookupAndParse = async (
  targetDir: string,
  network: Network
): Promise<UpgradeDescriptor> => {
  const networkPath = translateNetwork(network);

  const commonPath = path.join(targetDir, "common.json");
  const commonBuf = await fs.readFile(commonPath);
  const commonParser = SCHEMAS["common.json"];
  const commonData = commonParser.parse(JSON.parse(commonBuf.toString()));

  const transactionsPath = path.join(targetDir, networkPath, "transactions.json");
  const transactionsBuf = await fs.readFile(transactionsPath);
  const transactions = SCHEMAS["transactions.json"].parse(JSON.parse(transactionsBuf.toString()));

  const cryptoPath = path.join(targetDir, networkPath, "crypto.json");
  const cryptoBuf = await fs.readFile(cryptoPath);
  const crypto = SCHEMAS["crypto.json"].parse(JSON.parse(cryptoBuf.toString()));

  const facetCutsPath = path.join(targetDir, networkPath, "facetCuts.json");
  let facetCuts: FacetCutsJson | null;
  try {
    const facetCutsBuf = await fs.readFile(facetCutsPath);
    facetCuts = SCHEMAS["facetCuts.json"].parse(JSON.parse(facetCutsBuf.toString()));
  } catch (e) {
    facetCuts = null;
  }

  const facetsPath = path.join(targetDir, networkPath, "facets.json");
  let facets: FacetsJson | null;
  try {
    const facetCutsBuf = await fs.readFile(facetsPath);
    facets = SCHEMAS["facets.json"].parse(JSON.parse(facetCutsBuf.toString()));
  } catch (e) {
    facets = null;
  }

  const l2UpgradePath = path.join(targetDir, networkPath, "l2Upgrade.json");
  let l2Upgrade: L2UpgradeJson | undefined;
  try {
    const l2UpgradeBuf = await fs.readFile(l2UpgradePath);
    l2Upgrade = SCHEMAS["l2Upgrade.json"].parse(JSON.parse(l2UpgradeBuf.toString()));
  } catch (e) {
    // console.log(e)
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
