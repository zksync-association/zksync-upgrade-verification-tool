import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { NetworkSchema } from ".";
import { downloadCode, checkCommand, contractDiff } from "../commands";
import * as process from "node:process";
import { EnvBuilder } from "./env-builder.js";
import * as console from "node:console";
import { printError } from "./errors.js";

export const cli = async () => {
  // printIntro();
  const env = new EnvBuilder();

  const argParser = yargs(hideBin(process.argv))
    .middleware((yargs) => {
      if (!yargs.ethscankey) {
        yargs.ethscankey = process.env.ETHERSCAN_API_KEY;
      }
      if (!yargs.githubApiKey) {
        yargs.githubApiKey = process.env.API_KEY_GITHUB;
      }
    }, true)
    .option("ethscankey", {
      describe: "Api key for etherscan",
      type: "string",
      demandOption:
        "Please provide a valid Etherscan api key. You can set ETHERSCAN_API_KEY env var or use the option --ethscankey",
    })
    .option("githubApiKey", {
      describe: "Api key for github",
      type: "string",
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
      env.withGithubApiKey(yargs.githubApiKey);
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
        await checkCommand(env, yargs.upgradeDirectory);
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
        await contractDiff(env, yargs.upgradeDir, `facet:${yargs.facetName}`);
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
        await contractDiff(env, yargs.upgradeDir, "verifier");
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

        await downloadCode(env, yargs.upgradeDir, yargs.targetSourceCodeDir, filter);
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
        // console.log(_yargs.help())
        console.log(msg);
        process.exit(1);
      }

      printError(err);
      process.exit(1);
    })
    .strict();

  await argParser.parseAsync();
};
