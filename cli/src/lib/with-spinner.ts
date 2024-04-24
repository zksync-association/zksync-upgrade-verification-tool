import ora from "ora";

export async function withSpinner<T>(fn: () => Promise<T>): Promise<T> {
  const spinner = ora("Fetching contract data...").start();
  try {
    const res = await fn();
    spinner.stop()
    return res
  } catch (e) {
    spinner.stop()
    throw e
  }
}