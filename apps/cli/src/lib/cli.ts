import yargs, { type Argv } from "yargs";
import { hideBin } from "yargs/helpers";
import {
  checkCommand,
  downloadCodeCommand,
  storageChangeCommand,
  storageSnapshotCommand,
} from "../commands";
import * as process from "node:process";
import { EnvBuilder } from "./env-builder.js";
import { failHandler } from "../commands/fail-handler.js";
import { NetworkSchema } from "@repo/common/ethereum";
import pkg from "../../package.json";
import { idCommand } from "../commands/id-command";

export function buildCli(
  args: string[],
  checkCbk: typeof checkCommand,
  downloadCodeCbk: typeof downloadCodeCommand,
  storageDiffCbk: typeof storageChangeCommand,
  idCbk: typeof idCommand,
  failCbk: typeof failHandler
): Argv {
  const env = new EnvBuilder();
  const argParser = yargs(args)
    .scriptName("validate")
    .version(pkg.version)
    .middleware((yargs) => {
      if (!yargs.ethscankey) {
        yargs.ethscankey = process.env.ETHERSCAN_API_KEY;
      }
      if (!yargs.l1RpcUrl) {
        yargs.l1RpcUrl = process.env.L1_RPC_URL;
      }
    }, true)
    .option("ethscankey", {
      describe: "Api key for ethereum",
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
    .option("l1RpcUrl", {
      alias: "l1rpc",
      type: "string",
      describe: "Ethereum rpc url",
      demandOption: false,
    })
    .option("ref", {
      type: "string",
      describe: "github ref for era contracts repo",
      default: "main",
    })
    .option("noColor", {
      alias: "noFormat",
      type: "boolean",
      describe: "Use colored output",
      default: false,
    })
    .option("file", {
      alias: "f",
      type: "string",
      describe: "File with raw upgrade",
      demandOption: true,
    })
    .middleware((yargs) => {
      env.withNetwork(NetworkSchema.parse(yargs.network));
      env.withL1RpcUrl(yargs.l1RpcUrl);
      env.withEtherscanApiKey(yargs.ethscankey);
      env.withRef(yargs.ref);
      env.withColored(!yargs.noColor);
    })
    .command(
      "check",
      "get current state of contracts",
      (yargs) => yargs,
      async (yargs) => {
        await checkCbk(env, yargs.file);
      }
    )
    .command(
      "storage-diff",
      "Executes the upgrade transaction in debug mode to analyze the changes in contract storage",
      (yargs) =>
        yargs.option("precalculated", {
          type: "string",
          demandOption: false,
        }),
      async (yargs) => {
        return storageDiffCbk(env, yargs.file);
      }
    )
    .command(
      "storage-snapshot",
      "Shows a snapshot of the current state of the storage",
      (yargs) => yargs,
      async (_yargs) => {
        await storageSnapshotCommand(env);
      }
    )
    .command(
      "id",
      "Calculates id for upgrade",
      (yargs) => yargs,
      (yargs) => {
        idCbk(env, yargs.file);
      }
    )
    .command(
      "download-code <targetSourceCodeDir>",
      "Download source code diff",
      (yargs) =>
        yargs
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

        await downloadCodeCbk(env, yargs.file, yargs.targetSourceCodeDir, filter);
      }
    )
    .demandCommand(1, "Please specify a command")
    .wrap(100)
    .help()
    .fail(async (msg, err, _yargs) => {
      await failCbk(env, msg, err, argParser, () => process.exit(1));
    })
    .strict();

  return argParser;
}

export const cli = async () => {
  const argParser = buildCli(
    hideBin(process.argv),
    checkCommand,
    downloadCodeCommand,
    storageChangeCommand,
    idCommand,
    failHandler
  );
  await argParser.parseAsync();
};
