import type { Argv } from "yargs";
import console from "node:console";
import { printError } from "../lib/errors";
import process from "node:process";

export async function failHandler(msg: string, err: Error, argParser: Argv) {
  if (msg) {
    const help = await argParser.getHelp();
    console.log(help);
    console.log("");
    console.log(msg);
  } else {
    printError(err);
  }

  process.exit(1);
}
