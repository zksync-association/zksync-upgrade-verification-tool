import ora from "ora";
import * as console from "node:console";

export async function withSpinner<T>(fn: () => Promise<T>, taskDescription: string): Promise<T> {
  const spinner = ora(`${taskDescription}...`).start();
  try {
    const res = await fn();
    spinner.stop();
    console.log(`- ${taskDescription}: OK`);
    return res;
  } catch (e) {
    spinner.stop();
    throw e;
  }
}
