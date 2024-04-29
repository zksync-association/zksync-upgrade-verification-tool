import { compareCurrentStateWith } from "../lib";
import { temporaryDirectory } from "tempy";
import { exec } from "node:child_process";
import { withSpinner } from "../lib/with-spinner.js";
import type {EnvBuilder} from "../lib/env-builder.js";

export const contractDiff = async (
  env: EnvBuilder,
  upgradeDirectory: string,
  contractName: string,
  ref: string
) => {
  const github = env.github()
  const l2Client = env.l2Client()
  const targetDir = await withSpinner(async (): Promise<string> => {
    const { diff, l1Client } = await compareCurrentStateWith(
      env,
      upgradeDirectory
    );
    const targetDir = temporaryDirectory({ prefix: "zksync-era-upgrade-check" });
    await diff.writeCodeDiff(targetDir, [contractName], l1Client, l2Client, github, ref);
    return targetDir;
  }, "Gathering contract data");

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
