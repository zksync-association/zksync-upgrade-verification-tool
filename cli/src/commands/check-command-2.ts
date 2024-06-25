import type { EnvBuilder } from "../lib/env-builder";
import { CurrentZksyncEraState } from "../lib/current-zksync-era-state";
import fs from "node:fs/promises";
import path from "node:path";
import { transactionsSchema } from "../schema";
import { hexToBytes } from "viem";
import { NewZkSyncEraDiff } from "../lib/new-zk-sync-era-diff";
import {CheckReport} from "../lib/reports/check-report";

export async function checkCommand2(env: EnvBuilder, upgradeDirectory: string) {
  const current = await CurrentZksyncEraState.fromBlockchain(
    env.network,
    env.l1Client(),
    env.rpcL1()
  );

  const bufFile = await fs.readFile(path.join(upgradeDirectory, env.network, "transactions.json"));
  const txFile = transactionsSchema.parse(JSON.parse(bufFile.toString()));

  if (!txFile.governanceOperation) {
    throw new Error("missing hex");
  }

  const [proposed, systemContractsAddrs] = await CurrentZksyncEraState.fromCalldata(
    Buffer.from(hexToBytes(txFile.governanceOperation.calls[0].data)),
    env.network,
    env.l1Client(),
    env.rpcL1(),
    env.l2Client()
  );

  const diff = new NewZkSyncEraDiff(current, proposed, systemContractsAddrs);

  const report = new CheckReport(diff, await env.contractsRepo(), env.l1Client())
  console.log(await report.format());
}
