import {BlockExplorerClient, compareCurrentStateWith, type Network} from "../lib";

import {withSpinner} from "../lib/with-spinner.js";
import {GithubClient} from "../lib/github-client";

export async function downloadCode(
  etherscanKey: string,
  network: Network,
  upgradeDirectory: string,
  targetDir: string,
  l1Filter: string[],
  ref: string
): Promise<void> {
  const github = new GithubClient(process.env.GITHUB_API_KEY)
  const l2Client = BlockExplorerClient.forL2()

  const {diff, l1Client} = await withSpinner(
    () => compareCurrentStateWith(etherscanKey, network, upgradeDirectory),
    "Gathering contract data"
  );

  await withSpinner(
    () => diff.writeCodeDiff(targetDir, l1Filter, l1Client, l2Client, github, ref),
    'Downloading source code'
  )
  console.log(`Ok! Contracts written in: ${targetDir}`);
}
