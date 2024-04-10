import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { diffCommand, greetCommand, listCommand, verifyCommand } from "../commands";
import { printIntro } from ".";

export const cli = async () => {
  printIntro();

  await yargs(hideBin(process.argv))
    .command(
      "list",
      "List Upgrades",
      (yargs) =>
        yargs.option("directory", {
          describe: "Directory to list upgrades from",
          alias: "d",
          type: "string",
          // array: false,
          // conflicts: "directory",
          nargs: 1,
          demandOption: false,
        }),
      async (yargs) => {
        const directory = Array.isArray(yargs.directory) ? yargs.directory[0] : yargs.directory;
        Array.isArray(yargs.directory) &&
          console.log(`⚠️ Warning: Only the first directory will be used: ${directory}`);
        await listCommand(directory);
      }
    )
    .command(
      "verify <upgradeId>",
      "Check upgrade is well formed",
      (yargs) =>
        yargs.positional("upgradeId", {
          describe: "FolderName of the upgrade to verify",
          type: "string",
          demandOption: true,
        }),
      async (yargs) => {
        verifyCommand(yargs.upgradeId);
      }
    )
    .command(
      "diff <upgradeId> <previousUpgrade>",
      "Perform items",
      (yargs) =>
        yargs
          .positional("upgradeId", {
            describe: "FolderName of the upgrade to verify",
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
    .parseAsync();
};
