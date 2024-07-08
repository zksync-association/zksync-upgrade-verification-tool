import * as fs from "node:fs/promises";
import * as path from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { db } from "@/.server/db";
import { upgradesTable } from "@/.server/db/schema";
import { upgradeHandlerAbi } from "@/.server/service/protocol-upgrade-handler-abi";
import { env } from "@config/env.server";
import { eq } from "drizzle-orm";
import {
  BlockExplorerClient,
  type CheckReportObj,
  DIAMOND_ADDRS,
  type FieldStorageChange,
  type Network,
  ObjectCheckReport,
  ObjectStorageChangeReport,
  RpcClient,
  StorageChanges,
  ZkSyncEraDiff,
  ZksyncEraState,
  memoryDiffParser,
} from "validate-cli";
import type { ContractAbi } from "validate-cli/src/lib/contract-abi";
import { type Hex, hexToBigInt } from "viem";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const network = env.ETH_NETWORK;
const l1Explorer = BlockExplorerClient.forL1(env.ETHERSCAN_API_KEY, network);
const l1Rpc = new RpcClient(env.L1_RPC_CLI);
const l2Explorer = BlockExplorerClient.forL2(network);

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

export async function checkReport(_reportId: string): Promise<CheckReportObj> {
  const { current, proposed, sysAddresses } = await calculateBeforeAndAfter(
    network,
    l1Explorer,
    l2Explorer
  );

  const diff = new ZkSyncEraDiff(current, proposed, sysAddresses);
  const report = new ObjectCheckReport(diff, l1Explorer);
  return report.format();
}

export async function storageChangeReport(_reportId: string): Promise<FieldStorageChange[]> {
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

function newUpgradeTopics(abi: ContractAbi): Hex[] {
  return [abi.eventIdFor("UpgradeStarted")];
}

function finishedUpgradeTopics(abi: ContractAbi): Hex[] {
  return [abi.eventIdFor("UpgradeExecuted"), abi.eventIdFor("EmergencyUpgradeExecuted")];
}

const upgradeHandlerAddress = env.UPGRADE_HANDLER_ADDRESS;

// const bigIntMin = (...args: bigint[]) => args.reduce((m, e) => e < m ? e : m);

export async function queryNewUpgrades(): Promise<string[]> {
  // const from = bi  gIntMin([1n, ])
  const logs = await l1Rpc.getLogs(upgradeHandlerAddress, "0x01", "latest");
  const abi = upgradeHandlerAbi;

  const newUpgrades: Set<string> = new Set();

  const sorted = logs.sort((l1, l2) => {
    return Number(hexToBigInt(l1.blockNumber) - hexToBigInt(l2.blockNumber));
  });

  const creationTopics = newUpgradeTopics(abi);
  const finalizingTopics = finishedUpgradeTopics(abi);

  await db.transaction(async (tx) => {
    for (const log of sorted) {
      console.log("log", log, log.topics[0]);
      if (creationTopics.includes(log.topics[0])) {
        const [_topic, id] = log.topics;
        newUpgrades.add(id);
        await tx
          .insert(upgradesTable)
          .values({
            upgradeId: id,
            calldata: log.data,
            startedTxHash: log.transactionHash,
          })
          .onConflictDoNothing({ target: upgradesTable.upgradeId });
      }

      if (finalizingTopics.includes(log.topics[0])) {
        const [_topic, id] = log.topics;
        newUpgrades.delete(id);
        await tx
          .update(upgradesTable)
          .set({
            finishedTxHash: log.transactionHash,
          })
          .where(eq(upgradesTable.upgradeId, id));
      }
    }
  });

  return [...newUpgrades];
}
