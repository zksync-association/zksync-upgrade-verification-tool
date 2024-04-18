import {lookupAndParse, type Network} from "../lib";
import CliTable from "cli-table3";
import path from "node:path";
import {
  ALL_VERIFIER_PARAMS,
  type FacetCutsJson,
  type FacetsJson, type L2UpgradeJson,
  type TransactionsJson,
  type UpgradeManifest
} from "../schema";
import {cutAction, DiamondChanges} from "../lib/reports/diamond-changes.js";
import {AbiSet} from "../lib/abi-set.js";

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

// async function printGobernorActions(transactions: TransactionsJson, abiSet: AbiSet): Promise<void> {
//   // future: Get facets dinamically using loupe functionality.
//   const addr = '0x230214F0224C7E0485f348a79512ad00514DB1F7'
//   const data = transactions.governanceOperation.calls[0].data as HexString
//   const abi = await abiSet.fetch(addr)
//
//   const { args } = decodeFunctionData({
//     abi,
//     data
//   })
//
//   console.log(args)
// }

function printMetadata(data: UpgradeManifest) {
  const title = 'Upgrade metadata'
  console.log(title)
  console.log('='.repeat(title.length))

  const table = new CliTable({
    head: ['Key', 'Value'],
    style: { compact: true }
  })
  table.push(['name', data.name])
  table.push(['creation', new Date(data.creationTimestamp).toISOString()])
  table.push(['protocol version', data.protocolVersion])

  console.log(table.toString())
  console.log('\n\n')
}

function printNewSystemContracts(l2: L2UpgradeJson) {
  console.log('New system contracts')
  const table = new CliTable({
    head: ['Name', 'Address', 'Bytecode hashes'],
    style: { compact: true }
  })
  l2.systemContracts.forEach(contract => {
    const hashes = contract.bytecodeHashes.join(', ');
    table.push([ contract.name, contract.address, hashes ])
  })
  console.log(table.toString())
  console.log('')
}

function printGeneralL2Info(txs: TransactionsJson) {
  console.log('New attributes:')

  const table = new CliTable({
    head: ['Name', 'Value'],
    style: { compact: true }
  })

  table.push(['Bootloader Hash', txs.proposeUpgradeTx.bootloaderHash])
  table.push(['Default Accont Hash', txs.proposeUpgradeTx.defaultAccountHash])
  table.push(['Upgrade moment', new Date(Number(txs.proposeUpgradeTx.upgradeTimestamp.hex)).toString()])
  table.push(['New protocol version', txs.proposeUpgradeTx.newProtocolVersion])

  console.log(table.toString())
  console.log('')
}

function printL2TxInfo (proposeUpgradeTx: TransactionsJson ) {
  const tx = proposeUpgradeTx.proposeUpgradeTx.l2ProtocolUpgradeTx

  const table = new CliTable({
    head: ['Name', 'Value'],
    style: { compact: true }
  })

  table.push(['txType', tx.txType])
  // table.push(['from', tx.from])
  // const upgraderName = {
  //   '0x0000000000000000000000000000000000008007': 'FORCE_DEPLOYER_ADDRESS',
  //   '0x0000000000000000000000000000000000008006': 'CONTRACT_DEPLOYER_ADDRESS',
  //   '0x000000000000000000000000000000000000800f': 'COMPLEX_UPGRADE_ADDRESS'
  // }[tx.to] || `Custom deployer: ${tx.to}`
  table.push(['from:', tx.from])
  table.push(['nonce', tx.nonce])


  console.log(table.toString())
  console.log('')
}

async function printL2Upgrades(txs: TransactionsJson, l2?: L2UpgradeJson) {
  const title = 'Layer 2 Changes'
  console.log(title)
  console.log('='.repeat(title.length))
  console.log('')

  printGeneralL2Info(txs)

  printL2TxInfo(txs)

  printVerifierInformation(txs)

  if (l2) {
    printNewSystemContracts(l2)
  }

}

function printVerifierInformation (txs: TransactionsJson) {
  const newVerifier = Number(txs.proposeUpgradeTx.verifier) !== 0
  const newVerifierParams = ALL_VERIFIER_PARAMS.filter(param => {
    const value = txs.proposeUpgradeTx.verifierParams[param]
    return Number(value) !== 0
  })

  if (newVerifier || newVerifierParams.length > 0) {
    console.log('Verifier Changes:')

    const table = new CliTable({
      head: ['Attribute', 'value'],
      style: { compact: true }
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

  await printL2Upgrades(upgrade.transactions, upgrade.l2Upgrade)
};