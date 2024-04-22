import {lookupAndParse, type Network} from "../lib";
import CliTable from "cli-table3";
import path from "node:path";
import {
  ALL_VERIFIER_PARAMS,
  type L2UpgradeJson,
  type TransactionsJson,
  type UpgradeManifest
} from "../schema";
import {AbiSet} from "../lib/abi-set.js";
import {BlockExplorerClient} from "../lib/block-explorer-client.js";


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

  for (const contract of l2.systemContracts) {
    const hashes = contract.bytecodeHashes.join(', ');
    table.push([ contract.name, contract.address, hashes ])
  }

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

    for (const param of ALL_VERIFIER_PARAMS) {
      const raw = txs.proposeUpgradeTx.verifierParams[param]
      const newValue = Number(raw) === 0 ? 'no changes' : raw
      table.push([param, newValue])
    }

    console.log(table.toString())
  }
}

export const checkCommand = async (ethscanKey: string, upgradeDirectory: string, parentDirectory?: string, network: Network = 'mainnet') => {
  const client = new BlockExplorerClient(ethscanKey, network)
  const abiSet = new AbiSet(client)

  const basePath = path.resolve(process.cwd(), parentDirectory || "", upgradeDirectory);

  const upgrade = await lookupAndParse(basePath, network);

  printMetadata(upgrade.commonData)

  await printL2Upgrades(upgrade.transactions, upgrade.l2Upgrade)
};