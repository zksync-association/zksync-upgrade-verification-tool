import { getProposalByExternalId, updateProposal } from "@/.server/db/dto/proposals";
import { l1Explorer, l1Rpc, l2Explorer } from "@/.server/service/clients";
import { ALL_ABIS } from "@/utils/raw-abis";
import { env } from "@config/env.server";
import { defaultLogger } from "@config/log.server";
import { type BlockExplorerClient, DIAMOND_ADDRS, type Network } from "@repo/common/ethereum";
import {
  type CheckReportObj,
  ObjectCheckReport,
} from "@repo/ethereum-reports/reports/object-check-report";
import {
  type FieldStorageChange,
  ObjectStorageChangeReport,
} from "@repo/ethereum-reports/reports/object-storage-change-report";
import { RecordStorageSnapshot } from "@repo/ethereum-reports/storage/snapshot/record-storage-snapshot";
import { RpcStorageSnapshot } from "@repo/ethereum-reports/storage/snapshot/rpc-storage-snapshot";
import { StorageChanges } from "@repo/ethereum-reports/storage/storage-changes";
import { ZkSyncEraDiff } from "@repo/ethereum-reports/zk-sync-era-diff";
import { ZksyncEraState } from "@repo/ethereum-reports/zksync-era-state";
import { type Hex, decodeAbiParameters, getAbiItem, hexToBytes } from "viem";

const network = env.ETH_NETWORK === "local" ? "sepolia" : env.ETH_NETWORK;

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
    throw new Error("No calls specified in this address");
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

const emptyCheckReport = {
  metadata: {
    currentVersion: "0.24.1",
    proposedVersion: "0.25.0",
  },
  facetChanges: [],
  fieldChanges: [],
  systemContractChanges: [],
};

async function calculateCheckReport(_reportId: Hex, calldata: Hex): Promise<CheckReportObj> {
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

async function calculateStorageChangeReport(
  _proposalId: Hex,
  calldata: Hex
): Promise<FieldStorageChange[]> {
  if (env.SKIP_REPORTS) {
    return [];
  }

  const diamondAddress = DIAMOND_ADDRS[network];

  const abiItem = getAbiItem({
    abi: ALL_ABIS.handler,
    name: "execute",
  });
  const [upgradeProposal] = decodeAbiParameters([abiItem.inputs[0]], calldata);
  const [call] = upgradeProposal.calls;
  if (call === undefined) {
    return [];
  }
  const rawMap = await l1Rpc.debugCallTraceStorage(
    upgradeProposal.executor,
    call.target,
    call.data
  );
  const contractChanges = rawMap.result.post[diamondAddress];
  if (!contractChanges) {
    return [];
  }

  const selectors: Hex[] = [];
  const facetAddrs: Hex[] = [];

  const pre = new RpcStorageSnapshot(l1Rpc, diamondAddress);
  const storageDelta = new RecordStorageSnapshot(contractChanges.storage.unwrapOr({}));
  const post = pre.apply(storageDelta);

  const memoryMap: StorageChanges = new StorageChanges(pre, post, selectors, facetAddrs);
  const report = new ObjectStorageChangeReport(memoryMap);

  return report.format();
}

async function generateReportIfNotInDb<T>(
  proposalId: Hex,
  propName: "checkReport" | "storageDiffReport",
  generator: (id: Hex, calldata: Hex) => Promise<T>,
  emptyReport: T
): Promise<T> {
  if (env.SKIP_REPORTS) {
    return emptyReport;
  }

  const proposal = await getProposalByExternalId(proposalId);
  if (!proposal) {
    throw new Error("Unknown proposal");
  }
  if (!proposal[propName]) {
    try {
      proposal[propName] = await generator(proposalId, proposal.calldata);
    } catch (e) {
      defaultLogger.warn(e);
      return emptyReport;
    }

    await updateProposal(proposal);
  }

  return proposal[propName] as T;
}

export async function getCheckReport(proposalId: Hex): Promise<CheckReportObj> {
  return generateReportIfNotInDb(proposalId, "checkReport", calculateCheckReport, emptyCheckReport);
}

export async function getStorageChangeReport(proposalId: Hex): Promise<FieldStorageChange[]> {
  return generateReportIfNotInDb(proposalId, "storageDiffReport", calculateStorageChangeReport, []);
}
