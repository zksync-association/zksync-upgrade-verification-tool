import {BlockExplorerClient, compareCurrentStateWith, type Network} from "../lib";

import {withSpinner} from "../lib/with-spinner.js";
import {Octokit} from "@octokit/core";

export async function downloadCode(
  etherscanKey: string,
  network: Network,
  upgradeDirectory: string,
  targetDir: string,
  l1Filter: string[]
): Promise<void> {
  const octo = new Octokit({auth: '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'})
  const l2Client = BlockExplorerClient.forL2()

  const {diff, l1Client} = await withSpinner(
    () => compareCurrentStateWith(etherscanKey, network, upgradeDirectory),
    "Gathering contract data"
  );

  await withSpinner(
    () => diff.writeCodeDiff(targetDir, l1Filter, l1Client, l2Client, octo),
    'Downloading source code'
  )
  console.log(`Ok! Contracts written in: ${targetDir}`);
}
