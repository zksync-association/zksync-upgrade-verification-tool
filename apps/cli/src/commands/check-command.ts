import type { EnvBuilder } from "../lib/env-builder.js";
import { withSpinner } from "../lib/with-spinner.js";
import { ZksyncEraState } from "../reports/zksync-era-state";
import { ZkSyncEraDiff } from "../reports/zk-sync-era-diff";
import { DIAMOND_ADDRS } from "@repo/common/ethereum";
import { UpgradeFile } from "../lib/upgrade-file";
import { StringCheckReport } from "../reports/reports/string-check-report";
import { Diamond } from "../reports/diamond";

export async function checkCommand(env: EnvBuilder, upgradeFilePath: string) {
  const repo = await withSpinner(
    async () => {
      // const repo = await env.contractsRepo();
      // await repo.compileSystemContracts();
      // return repo;
      return await env.contractsRepo();
    },
    "Locally compiling system contracts",
    env
  );

  const file = UpgradeFile.fromFile(upgradeFilePath);

  const diamondaddr = DIAMOND_ADDRS[env.network];
  const diamond = await Diamond.create(diamondaddr, env.l1Client(), env.rpcL1());

  const current = await withSpinner(
    async () => ZksyncEraState.fromBlockchain(env.network, env.rpcL1(), diamond),
    "Gathering current zksync state",
    env
  );

  const proposed = await current.applyTxs(
    env.l1Client(),
    env.l2Client(),
    env.rpcL1(),
    env.network,
    file.calls
  );

  const diff = new ZkSyncEraDiff(current, proposed);

  const report = new StringCheckReport(diff, repo, env.l1Client());
  env.term().line(await report.format());
}
