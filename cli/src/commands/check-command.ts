import { compareCurrentStateWith } from "../lib";
import { withSpinner } from "../lib/with-spinner.js";
import type { EnvBuilder } from "../lib/env-builder.js";
import { GithubClient } from "../lib/github-client.js";

export async function checkCommand(
  env: EnvBuilder,
  upgradeDirectory: string,
  ref: string
): Promise<void> {
  const { diff, l1Abis } = await withSpinner(
    () => compareCurrentStateWith(env, upgradeDirectory),
    "Gathering contract data"
  );
  const github = env.github();
  console.log(await diff.toCliReport(l1Abis, upgradeDirectory, github, ref));
}
