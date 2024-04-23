import {compareCurrentStateWith, type Network} from '../lib';
import * as console from 'node:console';

export async function downloadCode (etherscanKey: string, network: Network, upgradeDirectory: string, targetDir: string, l1Filter: string[]): Promise<void> {
  const { diff} = await compareCurrentStateWith(etherscanKey, network, upgradeDirectory)
  await diff.writeCodeDiff(targetDir, l1Filter)
  console.log('Ok!')
}