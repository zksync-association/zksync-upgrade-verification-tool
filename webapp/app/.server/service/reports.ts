import * as fs from "node:fs/promises";
import * as path from "node:path";
import { dirname } from "node:path";
import { env } from "@config/env.server";
import {
  BlockExplorerClient,
  type CheckReportObj,
  type FieldStorageChange,
  memoryDiffParser,
  ObjectCheckReport,
  RpcClient,
  ZkSyncEraDiff,
  ZksyncEraState,
} from "validate-cli";
import { fileURLToPath } from "node:url";
import { DIAMOND_ADDRS, type Network, ObjectStorageChangeReport } from "validate-cli/src/index";
import { StorageChanges } from "validate-cli/src/lib/storage/storage-changes";
import { Hex, hexToBigInt, hexToBytes } from "viem";
import { db } from "@/.server/db/index";
import { upgradesTable } from "@/.server/db/schema";
import { eq } from "drizzle-orm";
import { ContractAbi } from "validate-cli/src/lib/contract-abi";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const network = env.ETH_NETWORK;
const l1Explorer = BlockExplorerClient.forL1(env.ETHERSCAN_API_KEY, network);
const l2Explorer = BlockExplorerClient.forL2(network);


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


  // const l1Rpc = new RpcClient(env.L1_RPC_CLI);

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

function newUpgradeTopics(abi: ContractAbi): Hex[] {
  return [
    abi.eventIdFor("TransparentOperationScheduled")
  ]
}

function finishedUpgradeTopics(abi: ContractAbi): Hex[] {
  return [
  abi.eventIdFor("TransparentOperationScheduled"),
    abi.eventIdFor("TransparentOperationScheduled")
  ]
}

export async function queryNewUpgrades(): Promise<string[]> {
  const logs = await l1Explorer.getLogs("0x0b622A2061EaccAE1c664eBC3E868b8438e03F61", 20009750n)
  const abi = await l1Explorer.getAbi("0x0b622A2061EaccAE1c664eBC3E868b8438e03F61")
  //
  const upgradeCreatedTopic = abi.eventIdFor("TransparentOperationScheduled")
  const upgradeExecutedTopic = abi.eventIdFor("OperationExecuted")
  const upgradeCanceledTopic = abi.eventIdFor("OperationCancelled")

  const newUpgrades: Set<string> = new Set()

  const sorted = logs.sort((l1, l2) => {
    return Number(hexToBigInt(l1.blockNumber) - hexToBigInt(l2.blockNumber))
  })

  await db.transaction(async tx => {

    for (const log of sorted) {
      if (log.topics[0] === upgradeCreatedTopic) {
        const [_topic, id] = log.topics
        newUpgrades.add(id)
        await db.insert(upgradesTable).values({
          upgradeId: id,
          calldata: log.data,
          startedTxid: log.transactionHash
        }).onConflictDoNothing({ target: upgradesTable.upgradeId })
      }

      if (log.topics[0] === upgradeExecutedTopic || log.topics[0] === upgradeCanceledTopic) {
        const [_topic, id] = log.topics
        newUpgrades.delete(id)
        await db.update(upgradesTable)
          .set({
            finishedTxid: log.transactionHash
        }).where(eq(upgradesTable.upgradeId, id))
      }
    }
  })

  return [...newUpgrades]
}