import { json, MetaFunction } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  ZksyncEraState,
  ZkSyncEraDiff,
  BlockExplorerClient,
  RpcClient,
  FileSystem,
  UpgradeImporter,
  CheckReport,
  GitContractsRepo
} from "validate-cli"
import { hexToBytes } from "viem";

export const meta: MetaFunction = () => {
  return [
    { title: "ZkSync Era upgrades" },
    { name: "description", content: "ZkSync Era upgrade voting tool" },
  ];
};

export async function loader() {
  const network = "mainnet"
  const l1Explorer = BlockExplorerClient.forL1("IA817WPSNENBAK9EE3SNM1C5C31YUTZ4MV", network)
  const l2Explorer = BlockExplorerClient.forL2(network)
  const l1Rpc = RpcClient.forL1(network)
  const current = await ZksyncEraState.fromBlockchain(network, l1Explorer, l1Rpc)

  const fileSystem = new FileSystem()
  const importer = new UpgradeImporter(fileSystem)

  const upgradeFiles = await importer.readFromFiles("/home/migue/Projects/moonsong/zksync-era/etc/upgrades/1711451944-hyperchain-upgrade", network)

  const buff = Buffer.from(hexToBytes(upgradeFiles.upgradeCalldataHex.unwrap()));
  const [proposed, sysAddresses] = await ZksyncEraState.fromCalldata(buff, network, l1Explorer, l1Rpc, l2Explorer)

  const diff = new ZkSyncEraDiff(current, proposed, sysAddresses)

  const repo = new GitContractsRepo("/home/migue/.cache/zksync-era-validate/era-contracts-repo")

  const report = new CheckReport(diff, repo, l1Explorer)

  return json({text: await report.format()})
}

export default function Index() {
  const data = useLoaderData<typeof loader>()
  return (
    <main className="font-sans p-4">
      <pre>
        {data.text}
      </pre>
    </main>
  );
}
