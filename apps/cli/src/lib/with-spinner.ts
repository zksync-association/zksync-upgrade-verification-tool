import ora from "ora";
import type { EnvBuilder } from "./env-builder.js";

export async function withSpinner<T>(
  fn: () => Promise<T>,
  taskDescription: string,
  env: EnvBuilder
): Promise<T> {
  const spinner = ora({
    text: `${taskDescription}...`,
    stream: env.term().out,
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
