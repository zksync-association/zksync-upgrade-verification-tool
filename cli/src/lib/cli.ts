import yargs from "yargs";
import {hideBin} from "yargs/helpers";
import {checkCommand, parseFromCalldata, diffCommand, listCommand} from "../commands";
import {type Network, printIntro} from ".";

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
      "check <upgradeDirectory>",
      "Check upgrade is well formed",
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
        await checkCommand(yargs.ethscankey, yargs.upgradeDirectory, yargs.directory, yargs.network as Network);
      }
    )
    .command(
      "diff <upgradeId> <previousUpgrade>",
      "Perform items",
      (yargs) =>
        yargs
          .positional("upgradeId", {
            describe: "FolderName of the upgrade to compare",
            type: "string",
            demandOption: true,
          })
          .positional("previousUpgrade", {
            describe: "FolderName of the previous upgrade to compare with",
            type: "string",
            demandOption: true,
          }),
      async (yargs) => {
        await diffCommand(yargs.upgradeId, yargs.previousUpgrade);
      }
    )
    .command(
      'parse <upgradeDirectory>',
      'command to test parse all from calldata',
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
        await parseFromCalldata(yargs.ethscankey, yargs.upgradeDirectory, yargs.directory, yargs.network as Network)
      }
    )
    .demandCommand(1, "You need to specify a command")
    .help()
    .strict()
    .parseAsync();
};
