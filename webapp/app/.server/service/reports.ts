import * as fs from "node:fs/promises";
import * as path from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { l1Explorer, l1Rpc, l2Explorer } from "@/.server/service/clients";
import { env } from "@config/env.server";
import {
  type BlockExplorerClient,
  type CheckReportObj,
  DIAMOND_ADDRS,
  type FieldStorageChange,
  memoryDiffParser,
  type Network,
  ObjectCheckReport,
  ObjectStorageChangeReport,
  StorageChanges,
  ZkSyncEraDiff,
  ZksyncEraState,
} from "validate-cli";
import { db } from "@/.server/db";
import { upgradesTable } from "@/.server/db/schema";
import { eq } from "drizzle-orm";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const network = env.ETH_NETWORK;

async function calculateBeforeAndAfter(
  network: Network,
  l1Explorer: BlockExplorerClient,
  l2Explorer: BlockExplorerClient
) {
  const current = await ZksyncEraState.fromBlockchain(network, l1Explorer, l1Rpc);

  const rawBuf = await fs.readFile(path.join(__dirname, "mock-upgrade.hex"));
  const decodedBuf = Buffer.from(rawBuf.toString(), "hex");

  const [proposed, sysAddresses] = await ZksyncEraState.fromCalldata(
    decodedBuf,
    network,
    l1Explorer,
    l1Rpc,
    l2Explorer
  );
  return { current, proposed, sysAddresses, callData: decodedBuf };
}

async function calculateCheckReport(_reportId: string): Promise<CheckReportObj> {
  const { current, proposed, sysAddresses } = await calculateBeforeAndAfter(
    network,
    l1Explorer,
    l2Explorer
  );

  const diff = new ZkSyncEraDiff(current, proposed, sysAddresses);
  const report = new ObjectCheckReport(diff, l1Explorer);
  return report.format();
}

async function calculateStorageChangeReport(_proposalId: string): Promise<FieldStorageChange[]> {
  const network = "mainnet";
  const diamondAddress = DIAMOND_ADDRS[network];

  const { current, proposed } = await calculateBeforeAndAfter(network, l1Explorer, l2Explorer);

  const memoryMapBuf = await fs.readFile(path.join(__dirname, "mock-memory-map.json"));
  const rawMap = memoryDiffParser.parse(JSON.parse(memoryMapBuf.toString()));

  const selectors = [...new Set([...current.allSelectors(), ...proposed.allSelectors()])];

  const facetAddrs = [...new Set([...current.allFacetsAddrs(), ...proposed.allFacetsAddrs()])];

  const memoryMap: StorageChanges = new StorageChanges(
    rawMap,
    diamondAddress,
    selectors,
    facetAddrs
  );
  const report = new ObjectStorageChangeReport(memoryMap);

  return report.format();
}

async function generateReportIfNotInDb<T>(proposalId: string, propName: "checkReport" | "storageDiffReport", generator: (t: string) => Promise<T>): Promise<T> {
  const proposal = await db.query.upgradesTable.findFirst({
    where: eq(upgradesTable.proposalId, proposalId)
  })

  if (!proposal) {
    throw new Error("Unknown proposal")
  }

  if (!proposal[propName]) {
    proposal[propName] = await generator(proposalId)
    await db.update(upgradesTable).set(proposal).where(eq(upgradesTable.proposalId, proposalId));
  }

  return proposal[propName] as T
}


export async function getCheckReport(proposalId: string): Promise<CheckReportObj> {
  return generateReportIfNotInDb(proposalId, "checkReport", calculateCheckReport)
}

export async function getStorageChangeReport(proposalId: string): Promise<FieldStorageChange[]> {
  return generateReportIfNotInDb(proposalId, "storageDiffReport", calculateStorageChangeReport)
}
