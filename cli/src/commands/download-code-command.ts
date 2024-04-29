import { BlockExplorerClient, compareCurrentStateWith, type Network } from "../lib";

import { withSpinner } from "../lib/with-spinner.js";
import { GithubClient } from "../lib/github-client";
import type {EnvBuilder} from "../lib/env-builder.js";

export async function downloadCode(
  env: EnvBuilder,
  upgradeDirectory: string,
  targetDir: string,
  l1Filter: string[],
  ref: string
): Promise<void> {
  const github = new GithubClient(process.env.GITHUB_API_KEY);
  const l2Client = BlockExplorerClient.forL2();

  const { diff, l1Client } = await withSpinner(
    () => compareCurrentStateWith(env, upgradeDirectory),
    "Gathering contract data"
  );

  await withSpinner(
    () => diff.writeCodeDiff(targetDir, l1Filter, l1Client, l2Client, github, ref),
    "Downloading source code"
  );
  console.log(`✅ Source code successfully downloaded in: ${targetDir}`);
}
