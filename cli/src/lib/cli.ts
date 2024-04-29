import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { NetworkSchema } from ".";
import { downloadCode, checkCommand, contractDiff } from "../commands";
import * as process from "node:process";

export const cli = async () => {
  // printIntro();
  await yargs(hideBin(process.argv))
    .option("directory", {
      describe: "Directory to list upgrades from",
      alias: "d",
      type: "string",
      demandOption: false,
      default: ".",
    })
    .middleware((yargs) => {
      if (!yargs.ethscankey) {
        yargs.ethscankey = process.env.ETHERSCAN_API_KEY;
      }
    }, true)
    .option("ethscankey", {
      describe: "Api key for etherscan",
      type: "string",
      demandOption: true,
    })
    .command(
      "check <upgradeDirectory>",
      "get current state of contracts",
      (yargs) =>
        yargs
          .positional("upgradeDirectory", {
            describe: "FolderName of the upgrade to check",
            type: "string",
            demandOption: true,
          })
          .option("network", {
            alias: "n",
            describe: "network to check",
            type: "string",
            default: "mainnet",
          }),
      async (yargs) => {
        await checkCommand(
          yargs.ethscankey,
          NetworkSchema.parse(yargs.network),
          yargs.upgradeDirectory
        );
      }
    )
    .command(
      "show-diff <upgradeDir> <facetName>",
      "Shows the diff for an specific contract",
      (yargs) =>
        yargs
          .positional("upgradeDir", {
            describe: "FolderName of the upgrade to check",
            type: "string",
            demandOption: true,
          })
          .positional("facetName", {
            describe: "Name of the facet to show diff",
            type: "string",
            demandOption: true,
          })
          .option("network", {
            alias: "n",
            describe: "network to check",
            type: "string",
            default: "mainnet",
          }),
      (yargs) => {
        contractDiff(
          yargs.ethscankey,
          NetworkSchema.parse(yargs.network),
          yargs.upgradeDir,
          yargs.facetName
        );
      }
    )
    .command(
      "download-diff <upgradeDir> <targetSourceCodeDir>",
      "Download source code diff",
      (yargs) =>
        yargs
          .positional("upgradeDir", {
            describe: "FolderName of the upgrade to check",
            type: "string",
            demandOption: true,
          })
          .positional("targetSourceCodeDir", {
            describe: "Directory to save the downloaded source code",
            type: "string",
            demandOption: true,
          })
          .option("facets", {
            describe: "Filter to this l1 contracts",
            type: "string",
            default: "",
          })
          .option("network", {
            alias: "n",
            describe: "network to check",
            type: "string",
            default: "mainnet",
          }),
      (yargs) => {
        const facets = yargs.facets
          .split(",")
          .map((f) => f.trim())
          .filter((f) => f.length > 0);
        downloadCode(
          yargs.ethscankey,
          NetworkSchema.parse(yargs.network),
          yargs.upgradeDir,
          yargs.targetSourceCodeDir,
          facets
        );
      }
    )
    .demandCommand(1, "Please specify a command")
    .help()
    .strict()
    .parseAsync();
};
