import type { EnvBuilder } from "../lib/env-builder.js";
import { hexToBytes } from "viem";
import { withSpinner } from "../lib/with-spinner.js";
import { ZksyncEraState } from "../reports/zksync-era-state";
import { ZkSyncEraDiff } from "../reports/zk-sync-era-diff";
import { DIAMOND_ADDRS } from "@repo/common/ethereum";
import { UpgradeFile } from "../lib/upgrade-file";
import { StringCheckReport } from "../reports/reports/string-check-report";

export async function checkCommand(env: EnvBuilder, upgradeFilePath: string) {
  const dataHex = UpgradeFile.fromFile(upgradeFilePath)
    .firstCallData()
    .expect(new Error("Missing calldata"));

  const current = await withSpinner(
    async () => ZksyncEraState.fromBlockchain(env.network, env.l1Client(), env.rpcL1()),
    "Gathering current zksync state",
    env
  );

  const repo = await withSpinner(
    async () => {
      const repo = await env.contractsRepo();
      await repo.compileSystemContracts();
      return repo;
    },
    "Locally compiling system contracts",
    env
  );

  const stateManagerAddress = current
    .hexAttrValue("stateTransitionManagerAddress")
    .expect(new Error("Should be present"));

  const [proposed, systemContractsAddrs] = await withSpinner(
    () =>
      ZksyncEraState.fromCalldata(
        stateManagerAddress,
        DIAMOND_ADDRS[env.network],
        Buffer.from(hexToBytes(dataHex)),
        env.network,
        env.l1Client(),
        env.rpcL1(),
        env.l2Client()
      ),
    "Calculating upgrade changes",
    env
  );

  const diff = new ZkSyncEraDiff(current, proposed, systemContractsAddrs);

  const report = new StringCheckReport(diff, repo, env.l1Client());
  env.term().line(await report.format());
}
