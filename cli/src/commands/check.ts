import {lookupAndParse, type Network} from "../lib";
import CliTable from "cli-table3";
import path from "node:path";
import {
  ALL_VERIFIER_PARAMS,
  type FacetCutsJson,
  type FacetsJson,
  type TransactionsJson,
  type UpgradeManifest
} from "../schema";
import {cutAction, DiamondChanges} from "../lib/reports/diamond-changes.js";
import {AbiSet} from "../lib/abi-set.js";
import {decodeFunctionData} from "viem";

type HexString = `0x${string}`

async function printFacetChanges (cuts: FacetCutsJson, facets: FacetsJson, abiSet: AbiSet): Promise<void> {
  const title = 'Diamond Changes'
  console.log(title)
  console.log('='.repeat(title.length))
  
  let promises = Object.keys(facets).map(async (facetName): Promise<any> => {
    const f = facets[facetName]
    return abiSet.fetch(f.address, facetName)
  })

  await Promise.all(promises)
  const diamondChanges = new DiamondChanges()

  cuts.forEach(cut => {
    const action = cutAction(cut.action)
    cut.selectors.forEach(selector => {
      diamondChanges.add(selector, action, cut.facet)
    })
  })

  console.log(diamondChanges.format(abiSet))
  console.log('\n\n')
}

async function printGobernorActions(transactions: TransactionsJson, abiSet: AbiSet): Promise<void> {
  // TODO: Get facets dinamically using loupe functionality.
  const addr = '0x230214F0224C7E0485f348a79512ad00514DB1F7'
  const data = transactions.governanceOperation.calls[0].data as HexString
  const abi = await abiSet.fetch(addr)

  const { args } = decodeFunctionData({
    abi,
    data
  })

  console.log(args)
}

function printMetadata(data: UpgradeManifest) {
  const title = 'Upgrade metadata'
  console.log(title)
  console.log('='.repeat(title.length))

  const table = new CliTable({
    head: ['Key', 'Value']
  })
  table.push(['name', data.name])
  table.push(['creation', new Date(data.creationTimestamp).toISOString()])
  table.push(['protocol version', data.protocolVersion])

  console.log(table.toString())
  console.log('\n\n')
}

async function printL2Upgrades(txs: TransactionsJson) {
  printVerifierInformation(txs)
}

function printVerifierInformation (txs: TransactionsJson) {
  const newVerifier = Number(txs.proposeUpgradeTx.verifier) !== 0
  const newVerifierParams = ALL_VERIFIER_PARAMS.filter(param => {
    const value = txs.proposeUpgradeTx.verifierParams[param]
    return Number(value) !== 0
  })

  if (newVerifier || newVerifierParams.length > 0) {
    const title = 'Verifier Changes'

    console.log(title)
    console.log('='.repeat(title.length))

    const table = new CliTable({
      head: ['Attribute', 'value']
    })
    const newAddress = newVerifier
      ? txs.proposeUpgradeTx.verifier
      : 'no changes'
    table.push(['Contract addr', newAddress])
    ALL_VERIFIER_PARAMS.forEach(param => {
      const raw = txs.proposeUpgradeTx.verifierParams[param]
      const newValue = Number(raw) === 0 ? 'no changes' : raw
      table.push([param, newValue])
    })

    console.log(table.toString())
  }
}

export const checkCommand = async (ethscanKey: string, upgradeDirectory: string, parentDirectory?: string, network: Network = 'mainnet') => {
  const abiSet = AbiSet.forL1(network, ethscanKey)

  const basePath = path.resolve(process.cwd(), parentDirectory || "", upgradeDirectory);

  const upgrade = await lookupAndParse(basePath, network);

  printMetadata(upgrade.commonData)

  // Print the names of all the methods being changed
  if (upgrade.facetCuts && upgrade.facets) {
    await printFacetChanges(upgrade.facetCuts, upgrade.facets, abiSet)
  }

  await printL2Upgrades(upgrade.transactions)
};