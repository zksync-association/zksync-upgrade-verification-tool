import type {Network} from "../lib/index.js";
import {createDiff} from "../lib/create-diff.js";
import {temporaryDirectory} from 'tempy'
import { exec } from 'node:child_process'
import * as console from "node:console";

export const contractDiff = async (etherscanKey: string, network: Network, upgradeDirectory: string, facetName: string) => {
  const { diff} = await createDiff(etherscanKey, network, upgradeDirectory)
  const targetDir = temporaryDirectory({ prefix: 'zksync-era-upgrade-check' })
  await diff.writeCodeDiff(targetDir, [facetName])

  await new Promise((resolve, reject) => {
    const res = exec(`git --no-pager diff --color=always ${targetDir}/old ${targetDir}/new`, (error, stdout, stderr) => {
      if (stderr.length > 0) {
        return reject(new Error('Error generating diff'))
      }
      console.log(stdout)
    })

    res.on('exit', () => resolve(null))
    res.on('disconnect', () => resolve(null))
  })
};
