import { calculateDiffWithUpgrade } from "../lib";

import { withSpinner } from "../lib/with-spinner.js";
import type { EnvBuilder } from "../lib/env-builder.js";
import { assertDirectoryExists } from "../lib/fs-utils.js";

export async function downloadCode(
  env: EnvBuilder,
  upgradeDirectory: string,
  targetDir: string,
  l1Filter: string[]
): Promise<void> {
  await assertDirectoryExists(targetDir);
  const { diff } = await calculateDiffWithUpgrade(env, upgradeDirectory, false);

  const l2Client = env.l2Client();
  const repo = await env.contractsRepo();

  await withSpinner(
    () => diff.writeCodeDiff(targetDir, l1Filter, env.l1Client(), l2Client, repo),
    "Downloading all source code"
  );

  console.log(`✅ Source code successfully downloaded in: ${targetDir}`);
}
