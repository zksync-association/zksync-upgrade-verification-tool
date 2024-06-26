import type { EnvBuilder } from "../lib/env-builder";
import { ZksyncEraState } from "../lib/zksync-era-state";
import { hexToBytes } from "viem";
import { ZkSyncEraDiff } from "../lib/zk-sync-era-diff";
import { CheckReport } from "../lib/reports/check-report";
import { withSpinner } from "../lib/with-spinner";
import { MalformedUpgrade } from "../lib/errors";

export async function checkCommand(env: EnvBuilder, upgradeDirectory: string) {
  const current = await withSpinner(
    async () => ZksyncEraState.fromBlockchain(env.network, env.l1Client(), env.rpcL1()),
    "Gathering current zksync state",
    env
  );

  const importer = env.importer();
  const upgrade = await importer.readFromFiles(upgradeDirectory, env.network);

  const data = upgrade.upgradeCalldataHex.expect(new MalformedUpgrade("Missing calldata for governor operations"));

  const repo = await withSpinner(
    async () => {
      const repo = await env.contractsRepo();
      await repo.compileSystemContracts();
      return repo;
    },
    "Locally compiling system contracts",
    env
  );

  const [proposed, systemContractsAddrs] = await withSpinner(
    () =>
      ZksyncEraState.fromCalldata(
        Buffer.from(hexToBytes(data)),
        env.network,
        env.l1Client(),
        env.rpcL1(),
        env.l2Client()
      ),
    "Calculating upgrade changes",
    env
  );

  const diff = new ZkSyncEraDiff(current, proposed, systemContractsAddrs);

  const report = new CheckReport(diff, repo, env.l1Client());
  env.term().line(await report.format());
}
