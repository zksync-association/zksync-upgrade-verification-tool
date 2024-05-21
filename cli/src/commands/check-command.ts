import { AbiSet, calculateDiffWithUpgrade } from "../lib";
import type { EnvBuilder } from "../lib/env-builder.js";
import { withSpinner } from "../lib/with-spinner";

export async function checkCommand(env: EnvBuilder, upgradeDirectory: string): Promise<void> {
  const { diff } = await calculateDiffWithUpgrade(env, upgradeDirectory)

  const abis = new AbiSet(env.l1Client())
  const report = await withSpinner(
    async () => diff.toCliReport(abis, upgradeDirectory, await env.contractsRepo()),
    'Generating report'
  )

  console.log(report);
}
