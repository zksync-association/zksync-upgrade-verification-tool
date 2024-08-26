import type { Argv } from "yargs";
import { printError } from "../lib/errors.js";
import type { EnvBuilder } from "../lib/env-builder.js";

export async function failHandler(
  env: EnvBuilder,
  msg: string | undefined,
  err: Error | undefined,
  argParser: Argv,
  onEnd: () => void
) {
  const term = env.term();
  if (msg) {
    const help = await argParser.getHelp();
    term.line(help);
    term.line("");
    term.line(msg);
  } else if (err) {
    printError(err, term);
  } else {
    throw new Error("No error or message received");
  }

  onEnd();
}
