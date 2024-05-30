import { ZkSyncEraState, type ZkSyncEraDiff } from ".";
import type { EnvBuilder } from "./env-builder.js";
import { withSpinner } from "./with-spinner";

export async function calculateDiffWithUpgrade(
  env: EnvBuilder,
  upgradeDirectory: string
): Promise<{ diff: ZkSyncEraDiff; state: ZkSyncEraState }> {
  const changes = await withSpinner(async () => {
    const importer = env.importer();
    return importer.readFromFiles(upgradeDirectory, env.network);
  }, "Reading proposed upgrade...");

  const state = await withSpinner(async () => {
    const l1Client = env.l1Client();
    return ZkSyncEraState.create(env.network, l1Client, env.rpcL1(), env.rpcL2());
  }, "Gathering contract data");

  const diff = await withSpinner(async () => {
    return state.calculateDiff(changes, env.l1Client());
  }, "Checking differences between versions");

  await withSpinner(async () => {
    const repo = await env.contractsRepo();
    await repo.compileSystemContracts();
  }, "Compiling system contracts");

  return {
    diff,
    state,
  };
}
