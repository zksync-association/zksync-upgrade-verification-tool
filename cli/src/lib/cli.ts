import yargs from "yargs";
import {hideBin} from "yargs/helpers";
import {listCommand} from "../commands";
import {type Network, printIntro} from ".";
import {snapshot} from "../commands/snapshot.js";
import * as console from "node:console";
import {downloadCode} from "../commands/download.js";

export const cli = async () => {
  printIntro();

  await yargs(hideBin(process.argv))
    .option("directory", {
      describe: "Directory to list upgrades from",
      alias: "d",
      type: "string",
      demandOption: false,
      default: ".",
    })
    .option("ethscankey", {
      describe: 'Api key for etherscan',
      type: 'string',
      demandOption: false,
      default: process.env.ETHERSCAN_API_KEY
    })
    .command(
      "list",
      "List Upgrades",
      (yargs) =>
        yargs.option("hide-non-upgrades", {
          type: "boolean",
          default: true,
          describe: "Hide directories that do not contain upgrades",
          alias: "hide",
        }),
      async ({directory, hideNonUpgrades}) => {
        const dir = Array.isArray(directory) ? directory[0] : directory;
        Array.isArray(directory) &&
        console.log(`⚠️ Warning: Only the first directory will be used: ${dir}`);
        await listCommand(directory, hideNonUpgrades);
      }
    )
    .command(
      'check <upgradeDirectory>',
      'get current state of contracts',
      (yargs) =>
        yargs.positional("upgradeDirectory", {
          describe: "FolderName of the upgrade to check",
          type: "string",
          demandOption: true,
        }).option("network", {
          alias: 'n',
          describe: 'network to check',
          type: 'string',
          default: 'mainnet'
        }),
      async (yargs) => {
        if (!yargs.ethscankey) {
          throw new Error('Etherscan api key not provided')
        }
        await snapshot(yargs.ethscankey, '0x32400084c286cf3e17e7b677ea9583e60a000324', yargs.network as Network, yargs.upgradeDirectory)
      }
    )
    .command(
      'download-diff <upgradeDir> <targetSourceCodeDir>',
      'Download source code diff',
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
          .option('l1', {
            describe: 'Filter to this l1 contracts',
            type: 'array',
            default: []
          }).option("network", {
          alias: 'n',
          describe: 'network to check',
          type: 'string',
          default: 'mainnet'
        }),
      (yargs) => {
        if (!yargs.ethscankey) {
          throw new Error('Etherscan api key not provided')
        }
        downloadCode(yargs.ethscankey, '0x32400084c286cf3e17e7b677ea9583e60a000324', yargs.network as Network, yargs.upgradeDir, yargs.targetSourceCodeDir)
      }
    )
    .demandCommand(1, "You need to specify a command")
    .help()
    .strict()
    .parseAsync();
};
