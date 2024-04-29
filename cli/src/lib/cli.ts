import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { NetworkSchema } from ".";
import { downloadCode, checkCommand, contractDiff } from "../commands";
import * as process from "node:process";

export const cli = async () => {
  // printIntro();
  await yargs(hideBin(process.argv))
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
    .option("network", {
      alias: "n",
      describe: "network to check",
      choices: ["mainnet", "sepolia"],
      type: "string",
      default: "mainnet",
    })
    .command(
      "check <upgradeDirectory>",
      "get current state of contracts",
      (yargs) =>
        yargs.positional("upgradeDirectory", {
          describe: "FolderName of the upgrade to check",
          type: "string",
          demandOption: true,
        })
          .option('ref', {
            describe: "github ref to download code",
            type: 'string',
            default: 'main'
          }),
      async (yargs) => {
        await checkCommand(
          yargs.ethscankey,
          NetworkSchema.parse(yargs.network),
          yargs.upgradeDirectory,
          yargs.ref
        );
      }
    )
    .command(
      "facet-diff <upgradeDir> <facetName>",
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
          .option("ref", {
            describe: "github ref to download code",
            type: "string",
            default: "main",
          }),
      async (yargs) => {
        await contractDiff(
          yargs.ethscankey,
          NetworkSchema.parse(yargs.network),
          yargs.upgradeDir,
          `facet:${yargs.facetName}`,
          yargs.ref
        );
      }
    )
    .command(
      "verifier-diff <upgradeDir>",
      "Shows code diff between current verifier source code and the proposed one",
      (yargs) =>
        yargs
          .positional("upgradeDir", {
            describe: "FolderName of the upgrade to check",
            type: "string",
            demandOption: true,
          })
          .option("ref", {
            describe: "github ref to download code",
            type: "string",
            default: "main",
          }),
      async (yargs) => {
        await contractDiff(
          yargs.ethscankey,
          NetworkSchema.parse(yargs.network),
          yargs.upgradeDir,
          "validator",
          yargs.ref
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
          .option("systemContracts", {
            alias: "sc",
            type: "string",
            default: "",
          })
          .option("verifier", {
            describe: "Filter to include verifier source code",
            type: "boolean",
            default: false,
          })
          .option("ref", {
            describe: "github ref to download code",
            type: "string",
            default: "main",
          }),
      (yargs) => {
        const filter = yargs.facets
          .split(",")
          .map((f) => f.trim())
          .filter((f) => f.length > 0)
          .map((f) => `facet:${f}`);

        if (yargs.verifier) {
          filter.push("verifier");
        }

        filter.push(
          ...yargs.systemContracts
            .split(",")
            .map((sc) => sc.trim())
            .filter((sc) => sc.length > 0)
            .map((sc) => `sc:${sc}`)
        );

        downloadCode(
          yargs.ethscankey,
          NetworkSchema.parse(yargs.network),
          yargs.upgradeDir,
          yargs.targetSourceCodeDir,
          filter,
          yargs.ref
        );
      }
    )
    .demandCommand(1, "Please specify a command")
    .help()
    .strict()
    .parseAsync();
};
