import * as fs from "node:fs/promises";
import * as path from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getProposalByExternalId, updateProposal } from "@/.server/db/dto/proposals";
import { l1Explorer, l1Rpc, l2Explorer } from "@/.server/service/clients";
import { env } from "@config/env.server";
import {
  type BlockExplorerClient,
  type CheckReportObj,
  DIAMOND_ADDRS,
  type FieldStorageChange,
  type Network,
  ObjectCheckReport,
  ObjectStorageChangeReport,
  StorageChanges,
  ZkSyncEraDiff,
  ZksyncEraState,
  memoryDiffParser,
} from "validate-cli";
import type { Hex } from "viem";

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

async function generateReportIfNotInDb<T>(
  proposalId: Hex,
  propName: "checkReport" | "storageDiffReport",
  generator: (t: string) => Promise<T>
): Promise<T> {
  const proposal = await getProposalByExternalId(proposalId);
  if (!proposal) {
    throw new Error("Unknown proposal");
  }

  if (!proposal[propName]) {
    proposal[propName] = await generator(proposalId);
    await updateProposal(proposal);
  }

  return proposal[propName] as T;
}

export async function getCheckReport(proposalId: Hex): Promise<CheckReportObj> {
  return generateReportIfNotInDb(proposalId, "checkReport", calculateCheckReport);
}

export async function getStorageChangeReport(proposalId: Hex): Promise<FieldStorageChange[]> {
  return generateReportIfNotInDb(proposalId, "storageDiffReport", calculateStorageChangeReport);
}
