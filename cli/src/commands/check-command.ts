import type {Network} from '../lib';
import {compareCurrentStateWith} from '../lib';
import ora from "ora";

export async function checkCommand (etherscanKey: string, network: Network, upgradeDirectory: string): Promise<void> {
  const spinner = ora('Fetching contract data...').start()
  try {
    const { diff, l1Abis} = await compareCurrentStateWith(etherscanKey, network, upgradeDirectory)
    spinner.stop()
    console.log(await diff.toCliReport(l1Abis, upgradeDirectory))
  } catch (e) {
    spinner.stop()
    throw e
  }
}