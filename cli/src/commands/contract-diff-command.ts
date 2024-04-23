import type {Network} from '../lib';
import {compareCurrentStateWith} from '../lib';
import {temporaryDirectory} from 'tempy'
import { exec } from 'node:child_process'

export const contractDiff = async (etherscanKey: string, network: Network, upgradeDirectory: string, facetName: string) => {
  const { diff} = await compareCurrentStateWith(etherscanKey, network, upgradeDirectory)
  const targetDir = temporaryDirectory({ prefix: 'zksync-era-upgrade-check' })
  await diff.writeCodeDiff(targetDir, [facetName])

  await new Promise((resolve, reject) => {
    const res = exec(`git --no-pager diff --color=always ${targetDir}/old ${targetDir}/new`, (_error, stdout, stderr) => {
      // We ignore the error because git diff returns status code 1 when there is a difference.
      if (stderr.length > 0) {
        return reject(new Error('Error generating diff'))
      }
      console.log(stdout)
    })

    res.on('exit', () => resolve(null))
    res.on('disconnect', () => resolve(null))
  })
};
