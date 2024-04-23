import {BlockExplorerClient} from "./block-explorer-client.js";
import {AbiSet} from "./abi-set.js";
import {Diamond, type DiamondDiff} from "./diamond.js";
import path from "node:path";
import {lookupAndParse} from "./importer.js";
import {FacetChanges} from "./reports/facet-changes.js";
import type {Network} from "./constants.js";

type CreateDiffResponse = {
  diff: DiamondDiff,
  l1Abis: AbiSet
}

export async function createDiff(etherscanKey: string, network: Network, upgradeDirectory: string): Promise<CreateDiffResponse> {
  const client = BlockExplorerClient.fromNetwork(etherscanKey, network)
  const l1Abis = new AbiSet(client)
  const diamond = await Diamond.create(network, client, l1Abis)


  const basePath = path.resolve(process.cwd(), upgradeDirectory);
  const upgrade = await lookupAndParse(basePath, network);


  // TODO: Remvove this
  // Right now we are taking care only of diamond changes. When we add l2 changes this is going to be removed
  // to consider all changes at the same time.
  if (!upgrade.facets || !upgrade.facetCuts) {
    throw new Error('No diamond upgrades')
  }

  const facetChanges = FacetChanges.fromFile(upgrade.commonData, upgrade.facetCuts, upgrade.facets)

  return {
    diff: await diamond.calculateDiff(facetChanges, client),
    l1Abis: l1Abis
  }
}