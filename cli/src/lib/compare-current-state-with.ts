import {
  AbiSet,
  BlockExplorerClient,
  ZkSyncEraState,
  UpgradeChanges,
  lookupAndParse,
  type ZkSyncEraDiff,
  type Network
} from '.';
import path from 'node:path';

type CreateDiffResponse = {
  diff: ZkSyncEraDiff,
  l1Abis: AbiSet
}

export async function compareCurrentStateWith (etherscanKey: string, network: Network, upgradeDirectory: string): Promise<CreateDiffResponse> {
  const client = BlockExplorerClient.fromNetwork(etherscanKey, network)
  const l1Abis = new AbiSet(client)
  const diamond = await ZkSyncEraState.create(network, client, l1Abis)


  const basePath = path.resolve(process.cwd(), upgradeDirectory);
  const upgrade = await lookupAndParse(basePath, network);


  // TODO: Remvove this
  // Right now we are taking care only of diamond changes. When we add l2 changes this is going to be removed
  // to consider all changes at the same time.
  if (!upgrade.facets || !upgrade.facetCuts) {
    throw new Error('No diamond upgrades')
  }

  const facetChanges = UpgradeChanges.fromFiles(upgrade.commonData, upgrade.transactions, upgrade.facets)

  return {
    diff: await diamond.calculateDiff(facetChanges, client),
    l1Abis: l1Abis
  }
}