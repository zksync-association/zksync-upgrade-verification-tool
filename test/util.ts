import {promisify} from "node:util";
import {exec} from "node:child_process";
import {expect} from "vitest";

export const execAsync = promisify(exec);


export const expectToFailAsync = async ( fn: () => Promise<any>): Promise<{ stdout: string, stderr: string }> => {
  try {
    await fn()
  } catch (e) {
    const err = e as any
    if (!err.stdout) {
      expect.fail(`Unexpected error: ${e}`)
    }
    return {
      stdout: err.stdout,
      stderr: err.stderr
    }
  }
  expect.fail('Command did not fail')
}