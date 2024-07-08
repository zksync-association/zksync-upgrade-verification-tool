import * as fs from "node:fs/promises";
import * as path from "node:path";
import { env } from "@config/env.server";
import {
  BlockExplorerClient,
  type CheckReportObj,
  type FieldStorageChange,
  ObjectCheckReport,
  RpcClient,
  ZkSyncEraDiff,
  ZksyncEraState,
  memoryDiffParser,
} from "validate-cli";

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DIAMOND_ADDRS, type Network, ObjectStorageChangeReport } from "validate-cli/src/index";
import { StorageChanges } from "validate-cli/src/lib/storage/storage-changes";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function calculateBeforeAndAfter(
  network: Network,
  l1Explorer: BlockExplorerClient,
  l2Explorer: BlockExplorerClient
) {
  const l1Rpc = RpcClient.forL1(network);
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

export async function getCheckReport(_reportId: string): Promise<CheckReportObj> {
  const network = "mainnet";
  const apiKey = env.ETHERSCAN_API_KEY;
  const l1Explorer = BlockExplorerClient.forL1(apiKey, network);
  const l2Explorer = BlockExplorerClient.forL2(network);

  const { current, proposed, sysAddresses } = await calculateBeforeAndAfter(
    network,
    l1Explorer,
    l2Explorer
  );

  const diff = new ZkSyncEraDiff(current, proposed, sysAddresses);
  const report = new ObjectCheckReport(diff, l1Explorer);
  return report.format();
}

export async function getStorageChangeReport(_reportId: string): Promise<FieldStorageChange[]> {
  const network = "mainnet";
  const diamondAddress = DIAMOND_ADDRS[network];
  const apiKey = env.ETHERSCAN_API_KEY;

  const l1Explorer = BlockExplorerClient.forL1(apiKey, network);
  const l2Explorer = BlockExplorerClient.forL2(network);

  // const l1Rpc = new RpcClient(env.L1_RPC_URL);

  const {
    current,
    proposed,
    // sysAddresses,
    // callData,
  } = await calculateBeforeAndAfter(network, l1Explorer, l2Explorer);

  // const rawMap = await l1Rpc.debugTraceCall(
  //   current.hexAttrValue("admin").unwrap(),
  //   diamondAddress,
  //   bytesToHex(callData)
  // );
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
