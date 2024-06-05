import yargs, { type Argv } from "yargs";
import { hideBin } from "yargs/helpers";
import { NetworkSchema } from ".";
import { downloadCode, checkCommand, contractDiff } from "../commands";
import * as process from "node:process";
import { EnvBuilder } from "./env-builder.js";
import * as console from "node:console";
import { printError } from "./errors.js";
import { memoryMapCommand } from "../commands/memory-map-command";

export function buildCli(
  args: string[],
  checkCbk: typeof checkCommand,
  diffCbk: typeof contractDiff,
  downloadCodeCbk: typeof downloadCode
): Argv {
  const env = new EnvBuilder();
  const argParser = yargs(args)
    .middleware((yargs) => {
      if (!yargs.ethscankey) {
        yargs.ethscankey = process.env.ETHERSCAN_API_KEY;
      }
    }, true)
    .option("ethscankey", {
      describe: "Api key for etherscan",
      type: "string",
      demandOption:
        "Please provide a valid Etherscan api key. You can set ETHERSCAN_API_KEY env var or use the option --ethscankey",
    })
    .option("network", {
      alias: "n",
      describe: "network to check",
      choices: ["mainnet", "sepolia"],
      type: "string",
      default: "mainnet",
    })
    .option("rpcUrl", {
      alias: "rpc",
      type: "string",
      describe: "Ethereum rpc url",
      demandOption: false,
    })
    .option("ref", {
      type: "string",
      describe: "github ref for era contracts repo",
      default: "main",
    })
    .middleware((yargs) => {
      env.withNetwork(NetworkSchema.parse(yargs.network));
      env.withRpcUrl(yargs.rpcUrl);
      env.withEtherscanApiKey(yargs.ethscankey);
      env.withRef(yargs.ref);
    })
    .command(
      "check <upgradeDirectory>",
      "get current state of contracts",
      (yargs) =>
        yargs.positional("upgradeDirectory", {
          describe: "FolderName of the upgrade to check",
          type: "string",
          demandOption: true,
        }),
      async (yargs) => {
        await checkCbk(env, yargs.upgradeDirectory);
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
          }),
      async (yargs) => {
        await diffCbk(env, yargs.upgradeDir, `facet:${yargs.facetName}`);
      }
    )
    .command(
      "verifier-diff <upgradeDir>",
      "Shows code diff between current verifier source code and the proposed one",
      (yargs) =>
        yargs.positional("upgradeDir", {
          describe: "FolderName of the upgrade to check",
          type: "string",
          demandOption: true,
        }),
      async (yargs) => {
        await diffCbk(env, yargs.upgradeDir, "verifier");
      }
    )
    .command(
      "storage-diff <upgradeDir>",
      "Executes the upgrade transaction in debug mode to analyze the changes in contract storage",
      (yargs) =>
        yargs.positional("upgradeDir", {
          describe: "FolderName of the upgrade to check",
          type: "string",
          demandOption: true,
        }),
      async (yargs) => {
        return memoryMapCommand(env, yargs.upgradeDir);
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
          }),
      async (yargs) => {
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

        await downloadCodeCbk(env, yargs.upgradeDir, yargs.targetSourceCodeDir, filter);
      }
    )
    .demandCommand(1, "Please specify a command")
    .wrap(100)
    .help()
    .fail(async (msg, err, _yargs) => {
      if (msg) {
        const help = await argParser.getHelp();
        console.log(help);
        console.log("");
        console.log(msg);
        // process.exit(1);
        return;
      }

      printError(err);
      // process.exit(1);
    })
    .strict();

  return argParser;
}

export const cli = async () => {
  const argParser = buildCli(hideBin(process.argv), checkCommand, contractDiff, downloadCode);
  await argParser.parseAsync();
};
