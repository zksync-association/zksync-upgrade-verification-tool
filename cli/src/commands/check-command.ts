import type { Network } from "../lib";
import { compareCurrentStateWith } from "../lib";
import { withSpinner } from "../lib/with-spinner.js";
import {GithubClient} from "../lib/github-client.js";

export async function checkCommand(
  etherscanKey: string,
  network: Network,
  upgradeDirectory: string,
  ref: string
): Promise<void> {
  const { diff, l1Abis } = await withSpinner(
    () => compareCurrentStateWith(etherscanKey, network, upgradeDirectory),
    "Gathering contract data"
  );
  const github = new GithubClient()
  console.log(await diff.toCliReport(l1Abis, upgradeDirectory, github, ref));
}
