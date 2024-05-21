import { AbiSet, ZkSyncEraState, type ZkSyncEraDiff } from ".";
import type { EnvBuilder } from "./env-builder.js";

export async function calculateDiffWithUpgrade(
  env: EnvBuilder,
  upgradeDirectory: string
): Promise<{ diff: ZkSyncEraDiff, state: ZkSyncEraState }> {
  const importer = env.importer();

  const changes = await importer.readFromFiles(upgradeDirectory, env.network);

  const l1Client = env.l1Client();
  const l1Abis = new AbiSet(l1Client);
  const zkSyncState = await ZkSyncEraState.create(
    env.network,
    l1Client,
    l1Abis,
    env.rpcL1(),
    env.rpcL2()
  );

  return {
    diff: await zkSyncState.calculateDiff(changes, l1Client),
    state: zkSyncState
  }
}
