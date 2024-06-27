export const dynamic = 'force-dynamic' // defaults to auto
import {
  ZkSyncEraDiff,
  ZksyncEraState,
  UpgradeImporter,
  FileSystem,
  BlockExplorerClient,
  RpcClient,
  CheckReport,
  GitContractsRepo
} from "validate-cli";
import { etherscanApiKey } from "@/utils";
import { hexToBytes } from "viem";

export async function GET() {
  const network = "mainnet";
  const l1Explorer = BlockExplorerClient.forL1(etherscanApiKey(), network)
  const l2Explorer = BlockExplorerClient.forL2(network)
  const rpc = RpcClient.forL1(network)
  const current = await ZksyncEraState.fromBlockchain(network, l1Explorer, rpc)

  const fileSystem = new FileSystem()
  const importer = new UpgradeImporter(fileSystem)
  const imported = await importer.readFromFiles(
    "/home/migue/Projects/moonsonglabs/zksync-era/etc/upgrades/1711451944-hyperchain-upgrade",
    network
  )

  const [proposed, sysContractsAddresses] = await ZksyncEraState.fromCalldata(
    Buffer.from(hexToBytes(imported.upgradeCalldataHex.unwrap())),
    network,
    l1Explorer,
    rpc,
    l2Explorer
  )

  const diff = new ZkSyncEraDiff(current, proposed, sysContractsAddresses)
  const repo = new GitContractsRepo("/home/migue/.cache/zksync-era-validate/era-contracts-repo")

  const report = new CheckReport(
    diff,
    repo,
    l1Explorer
  )

  return Response.json({
    text: await report.format()
  })
}