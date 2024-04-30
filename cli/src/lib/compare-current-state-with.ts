import {
  AbiSet,
  BlockExplorerClient,
  ZkSyncEraState,
  UpgradeChanges,
  lookupAndParse,
  type ZkSyncEraDiff,
  type Network,
} from ".";
import path from "node:path";

type CreateDiffResponse = {
  diff: ZkSyncEraDiff;
  l1Abis: AbiSet;
  l1Client: BlockExplorerClient;
};

export async function compareCurrentStateWith(
  etherscanKey: string,
  network: Network,
  upgradeDirectory: string
): Promise<CreateDiffResponse> {
  const l1Client = BlockExplorerClient.fromNetwork(etherscanKey, network);
  const l1Abis = new AbiSet(l1Client);
  const zkSyncState = await ZkSyncEraState.create(network, l1Client, l1Abis);

  const basePath = path.resolve(process.cwd(), upgradeDirectory);
  const upgrade = await lookupAndParse(basePath, network);

  const facetChanges = UpgradeChanges.fromFiles(
    upgrade.commonData,
    upgrade.transactions,
    upgrade.facets,
    upgrade.l2Upgrade
  );

  return {
    diff: await zkSyncState.calculateDiff(facetChanges, l1Client),
    l1Abis,
    l1Client,
  };
}
