import type {EnvBuilder} from "../lib/env-builder";
import {CurrentZksyncEraState} from "../lib/current-zksync-era-state";
import fs from "node:fs/promises";
import path from "node:path";
import {transactionsSchema} from "../schema";
import {hexToBytes} from "viem";
import {NewZkSyncEraDiff} from "../lib/new-zk-sync-era-diff";
import {CheckReport} from "../lib/reports/check-report";
import {withSpinner} from "../lib/with-spinner";

export async function checkCommand2(env: EnvBuilder, upgradeDirectory: string) {
  const current = await withSpinner(async () =>
      CurrentZksyncEraState.fromBlockchain(
        env.network,
        env.l1Client(),
        env.rpcL1()
      ),
    "Gathering current zksync state",
    env
  );

  const bufFile = await fs.readFile(path.join(upgradeDirectory, env.network, "transactions.json"));
  const txFile = transactionsSchema.parse(JSON.parse(bufFile.toString()));

  if (!txFile.governanceOperation) {
    throw new Error("Missing governance operation transaction");
  }
  const data = txFile.governanceOperation.calls[0].data

  const repo = await withSpinner(async () => {
    const repo = await env.contractsRepo();
    await repo.compileSystemContracts();
    return repo
  }, "Locally compiling system contracts", env)

  const [proposed, systemContractsAddrs] = await withSpinner(
    () => CurrentZksyncEraState.fromCalldata(
      Buffer.from(hexToBytes(data)),
      env.network,
      env.l1Client(),
      env.rpcL1(),
      env.l2Client()
    ),
    "Calculating upgrade changes",
    env
  );

  const diff = new NewZkSyncEraDiff(current, proposed, systemContractsAddrs);

  const report = new CheckReport(diff, repo, env.l1Client());
  env.term().line(await report.format());
}
