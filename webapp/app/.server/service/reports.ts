// import * as process from "node:process";
// import {
//   BlockExplorerClient,
//   CheckReport,
//   FileSystem,
//   GitContractsRepo,
//   RpcClient,
//   UpgradeImporter,
//   ZkSyncEraDiff,
//   ZksyncEraState,
// } from "validate-cli";
// import { hexToBytes } from "viem";

// export async function checkReport(upgradeDir: string, repoPath: string): Promise<string> {
//   const network = "mainnet";
//   const apiKey = process.env.ETHERSCAN_API_KEY;
//   if (!apiKey) {
//     throw new Error("No api key");
//   }
//   const l1Explorer = BlockExplorerClient.forL1(apiKey, network);
//   const l2Explorer = BlockExplorerClient.forL2(network);
//   const l1Rpc = RpcClient.forL1(network);
//   const current = await ZksyncEraState.fromBlockchain(network, l1Explorer, l1Rpc);

//   const fileSystem = new FileSystem();
//   const importer = new UpgradeImporter(fileSystem);

//   const upgradeFiles = await importer.readFromFiles(upgradeDir, network);

//   const buff = Buffer.from(hexToBytes(upgradeFiles.upgradeCalldataHex.unwrap()));
//   const [proposed, sysAddresses] = await ZksyncEraState.fromCalldata(
//     buff,
//     network,
//     l1Explorer,
//     l1Rpc,
//     l2Explorer
//   );

//   const diff = new ZkSyncEraDiff(current, proposed, sysAddresses);

//   const repo = new GitContractsRepo(repoPath);

//   const report = new CheckReport(diff, repo, l1Explorer);
//   return report.format();
// }
