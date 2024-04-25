import {BlockExplorerClient, compareCurrentStateWith, type Network} from "../lib";

import { withSpinner } from "../lib/with-spinner.js";
import {Octokit} from "@octokit/core";

export async function downloadCode(
  etherscanKey: string,
  network: Network,
  upgradeDirectory: string,
  targetDir: string,
  l1Filter: string[]
): Promise<void> {
  const octo = new Octokit()
  const l2Client = BlockExplorerClient.forL2()
  const { diff, l1Client } = await withSpinner(() =>
    compareCurrentStateWith(etherscanKey, network, upgradeDirectory)
  );
  await diff.writeCodeDiff(targetDir, l1Filter, l1Client, l2Client, octo);
  console.log(`Ok! Contracts written in: ${targetDir}`);
}
