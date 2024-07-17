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
import { decodeAbiParameters, getAbiItem, Hex, hexToBytes } from "viem";
import { ALL_ABIS } from "@/utils/raw-abis";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const network = env.ETH_NETWORK;

async function calculateBeforeAndAfter(
  network: Network,
  l1Explorer: BlockExplorerClient,
  l2Explorer: BlockExplorerClient,
  calldata: Hex
) {
  const current = await ZksyncEraState.fromBlockchain(network, l1Explorer, l1Rpc);

  const abiItem = getAbiItem({
    abi: ALL_ABIS.handler,
    name: "execute",
  });

  const [upgradeProposal] = decodeAbiParameters([abiItem.inputs[0]], calldata);

  const call = upgradeProposal.calls[0];

  if (!call) {
    throw new Error("No calls specified in this address")
  }

  const [proposed, sysAddresses] = await ZksyncEraState.fromCalldata(
    upgradeProposal.executor,
    call.target,
    Buffer.from(hexToBytes(call.data)),
    network,
    l1Explorer,
    l1Rpc,
    l2Explorer
  );
  return { current, proposed, sysAddresses };
}

async function calculateCheckReport(_reportId: Hex, calldata: Hex): Promise<CheckReportObj> {
  if (env.SKIP_REPORTS) {
    return {
      metadata: {
        currentVersion: "0.24.1",
        proposedVersion: "0.25.0"
      },
      facetChanges: [],
      fieldChanges: [],
      systemContractChanges: []
    }
  }

  const { current, proposed, sysAddresses } = await calculateBeforeAndAfter(
    network,
    l1Explorer,
    l2Explorer,
    calldata
  );
  const diff = new ZkSyncEraDiff(current, proposed, sysAddresses);
  const report = new ObjectCheckReport(diff, l1Explorer);
  return report.format();
}

async function calculateStorageChangeReport(_proposalId: Hex, calldata: Hex): Promise<FieldStorageChange[]> {
  if (env.SKIP_REPORTS) {
    return []
  }

  const network = "mainnet";
  const diamondAddress = DIAMOND_ADDRS[network];

  const { current, proposed } = await calculateBeforeAndAfter(network, l1Explorer, l2Explorer, calldata);

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
  generator: (id: Hex, calldata: Hex) => Promise<T>
): Promise<T> {

  const proposal = await getProposalByExternalId(proposalId);
  if (!proposal) {
    throw new Error("Unknown proposal");
  }
  if (!proposal[propName]) {
    proposal[propName] = await generator(proposalId, proposal.calldata);
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
