import {AbiSet} from "../lib/abi-set.js";
import {Diamond} from "../lib/diamond.js";
import path from "node:path";
import {lookupAndParse, type Network} from "../lib/index.js";
import {FacetChanges} from "../lib/reports/facet-changes.js";
import {EtherscanClient} from "../lib/etherscan-client.js";

export async function snapshot (etherscanKey: string, addr: string, network: Network, upgradeDirectory: string): Promise<void> {
  const client = new EtherscanClient(etherscanKey, network)
  const l1Abis = new AbiSet(client)
  const diamond = new Diamond(addr, l1Abis)

  await diamond.init(client)

  const basePath = path.resolve(process.cwd(), upgradeDirectory,);
  const upgrade = await lookupAndParse(basePath, network);

  const facetChanges = FacetChanges.fromFile(upgrade.facetCuts!, upgrade.facets!)

  const diff = await diamond.calculateDiff(facetChanges, client)
  // const tempDir = temporaryDirectory({prefix: 'zksync-era-diff'})
  await diff.writeDiffs('/home/migue/borrar')
}