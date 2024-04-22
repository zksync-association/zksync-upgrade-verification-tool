import type {Network} from "../lib/index.js";
import * as console from "node:console";
import {createDiff} from "../lib/create-diff.js";

export async function downloadCode (etherscanKey: string, addr: string, network: Network, upgradeDirectory: string, targetDir: string, l1Filter: string[]): Promise<void> {
  const { diff} = await createDiff(addr, etherscanKey, network, upgradeDirectory)
  await diff.writeCodeDiff(targetDir, l1Filter)
  console.log('Ok!')
}