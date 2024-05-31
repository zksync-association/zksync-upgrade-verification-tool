import { calculateDiffWithUpgrade } from "../lib";
import { temporaryDirectory } from "tempy";
import { exec } from "node:child_process";
import type { EnvBuilder } from "../lib/env-builder.js";

export const contractDiff = async (
  env: EnvBuilder,
  upgradeDirectory: string,
  contractName: string
) => {
  const repo = await env.contractsRepo();
  const l2Client = env.l2Client();

  const targetDir = temporaryDirectory({ prefix: "zksync-era-upgrade-check" });
  const l1Client = env.l1Client();
  const { diff } = await calculateDiffWithUpgrade(env, upgradeDirectory);
  await diff.writeCodeDiff(targetDir, [contractName], l1Client, l2Client, repo);

  await new Promise((resolve, reject) => {
    const res = exec(
      `git --no-pager diff --color=always ${targetDir}/old ${targetDir}/new`,
      (_error, stdout, stderr) => {
        // We ignore the error because git diff returns status code 1 when there is a difference.
        if (stderr.length > 0) {
          return reject(new Error("Error generating diff"));
        }
        console.log(stdout);
      }
    );

    res.on("exit", () => resolve(null));
    res.on("disconnect", () => resolve(null));
  });
};
