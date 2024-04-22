import {AbiSet} from "../lib/abi-set.js";
import {Diamond} from "../lib/diamond.js";
import path from "node:path";
import {lookupAndParse, type Network} from "../lib/index.js";
import {FacetChanges} from "../lib/reports/facet-changes.js";
import {BlockExplorerClient} from "../lib/block-explorer-client.js";
import * as console from "node:console";

export async function snapshot (etherscanKey: string, addr: string, network: Network, upgradeDirectory: string): Promise<void> {
  const client = BlockExplorerClient.fromNetwork(etherscanKey, network)
  const l1Abis = new AbiSet(client)
  const diamond = new Diamond(addr, l1Abis)

  await diamond.init(client)

  const basePath = path.resolve(process.cwd(), upgradeDirectory,);
  const upgrade = await lookupAndParse(basePath, network);

  if (!upgrade.facets || !upgrade.facetCuts) {
    console.log('no diamond upgrades')
    return
  }

  const facetChanges = FacetChanges.fromFile(upgrade.facetCuts, upgrade.facets)

  const diff = await diamond.calculateDiff(facetChanges, client)

  console.log(diff.toCliReport(l1Abis))
}