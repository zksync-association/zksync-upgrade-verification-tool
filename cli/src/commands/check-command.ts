import { compareCurrentStateWith } from "../lib";
import { withSpinner } from "../lib/with-spinner.js";
import type { EnvBuilder } from "../lib/env-builder.js";

export async function checkCommand(env: EnvBuilder, upgradeDirectory: string): Promise<void> {
  const { diff, l1Abis } = await withSpinner(
    () => compareCurrentStateWith(env, upgradeDirectory),
    "Gathering contract data"
  );

  console.log(await diff.toCliReport(l1Abis, upgradeDirectory, await env.contractsRepo()));
}
