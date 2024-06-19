import ora from "ora";
import * as console from "node:console";
import {EnvBuilder} from "./env-builder";

export async function withSpinner<T> (fn: () => Promise<T>, taskDescription: string, env: EnvBuilder): Promise<T> {
  const spinner = ora({
    text: `${taskDescription}...`,
    stream: env.term().out
  }).start();
  try {
    const res = await fn();
    spinner.succeed(`${taskDescription}`);
    return res;
  } catch (e) {
    spinner.fail("Error");
    throw e;
  }
}
