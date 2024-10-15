import type { EnvBuilder } from "../lib/env-builder.js";
import { withSpinner } from "../lib/with-spinner.js";
import { ZksyncEraState } from "../reports/zksync-era-state";
import { ZkSyncEraDiff } from "../reports/zk-sync-era-diff";
import { UpgradeFile } from "../lib/upgrade-file";
import { StringCheckReport } from "../reports/reports/string-check-report";
import { RpcSystemContractProvider } from "../reports/system-contract-providers";

export async function checkCommand(env: EnvBuilder, upgradeFilePath: string) {
  const repo = await withSpinner(
    async () => {
      const repo = await env.contractsRepo();
      await repo.compileSystemContracts();
      return repo;
    },
    "Locally compiling system contracts",
    env
  );

  const upgradeFile = UpgradeFile.fromFile(upgradeFilePath);

  const current = await withSpinner(
    async () =>
      ZksyncEraState.fromBlockchain(
        env.network,
        env.rpcL1(),
        env.l1Client(),
        new RpcSystemContractProvider(env.rpcL2(), env.l2Client())
      ),
    "Gathering current zksync state",
    env
  );

  const proposed = await withSpinner(
    async () =>
      current.applyTxs(env.l1Client(), env.l2Client(), env.rpcL1(), env.network, upgradeFile.calls),
    "Simulating upgrade",
    env
  );

  const report = await withSpinner(
    async () => {
      const diff = new ZkSyncEraDiff(current, proposed);
      return new StringCheckReport(diff, repo, env.l1Client());
    },
    "Generating report",
    env
  );

  env.term().line(await report.format());
}
