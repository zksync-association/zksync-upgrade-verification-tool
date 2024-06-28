import { calculateDiffWithUpgrade } from "../lib";
import type { EnvBuilder } from "../lib/env-builder.js";
import { withSpinner } from "../lib/with-spinner";

export async function checkCommand(env: EnvBuilder, upgradeDirectory: string): Promise<void> {
  const { diff } = await calculateDiffWithUpgrade(env, upgradeDirectory);

  const report = await withSpinner(
    async () => diff.toCliReport(env.l1Client(), upgradeDirectory, await env.contractsRepo()),
    "Generating report",
    env
  );

  env.term().line(report);
}
