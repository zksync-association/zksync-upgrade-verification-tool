import type {Network} from '../lib';
import {compareCurrentStateWith} from '../lib';

export async function checkCommand (etherscanKey: string, network: Network, upgradeDirectory: string): Promise<void> {
  const { diff, l1Abis} = await compareCurrentStateWith(etherscanKey, network, upgradeDirectory)

  console.log(await diff.toCliReport(l1Abis, upgradeDirectory))
}