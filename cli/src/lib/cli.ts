import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { diffCommand, greetCommand, listCommand, checkCommand } from "../commands";
import { NetworkSchema, printIntro } from ".";

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
      async ({ directory, hideNonUpgrades }) => {
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
        }),
      async (yargs) => {
        await checkCommand(yargs.upgradeDirectory, yargs.directory);
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
        diffCommand(yargs.upgradeId, yargs.previousUpgrade);
      }
    )
    .command(
      "greet [person]",
      "Greets the user",
      async (yargs) =>
        yargs.positional("person", {
          describe: "Name of the person to greet",
          type: "string",
        }),
      async (argv) => {
        greetCommand(argv.person);
      }
    )
    .demandCommand(1, "You need to specify a command")
    .help()
    .strict()
    .parseAsync();
};
