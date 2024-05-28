import {
  AbiSet,
  ZkSyncEraState,
  UpgradeChanges,
  type ZkSyncEraDiff,
} from ".";
import type { EnvBuilder } from "./env-builder.js";
import { withSpinner } from "./with-spinner";


export async function calculateDiffWithUpgrade(
  env: EnvBuilder,
  upgradeDirectory: string
): Promise<{ diff: ZkSyncEraDiff, state: ZkSyncEraState }> {
  const state = await withSpinner(async () => {
    const l1Client = env.l1Client();
    const l1Abis = new AbiSet(l1Client);
    return ZkSyncEraState.create(
      env.network,
      l1Client,
      l1Abis,
      env.rpcL1(),
      env.rpcL2()
    );
  }, "Gathering contract data");


  await withSpinner(async () => {
    const repo = await env.contractsRepo()
    await repo.compile()
  }, 'Compiling system contracts')

  const diff = await withSpinner(
    async () => {
      const importer = env.importer();

      const changes = await importer.readFromFiles(upgradeDirectory, env.network);

      return state.calculateDiff(changes, env.l1Client())
    },
    'Checking differences between versions'
  )

  return {
    diff,
    state
  }
}