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
  client: BlockExplorerClient;
};

export async function compareCurrentStateWith(
  etherscanKey: string,
  network: Network,
  upgradeDirectory: string
): Promise<CreateDiffResponse> {
  const client = BlockExplorerClient.fromNetwork(etherscanKey, network);
  const l1Abis = new AbiSet(client);
  const zkSyncState = await ZkSyncEraState.create(network, client, l1Abis);

  const basePath = path.resolve(process.cwd(), upgradeDirectory);
  const upgrade = await lookupAndParse(basePath, network);

  const facetChanges = UpgradeChanges.fromFiles(
    upgrade.commonData,
    upgrade.transactions,
    upgrade.facets,
    upgrade.l2Upgrade
  );

  return {
    diff: await zkSyncState.calculateDiff(facetChanges, client),
    l1Abis,
    client,
  };
}
