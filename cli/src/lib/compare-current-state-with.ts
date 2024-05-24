import {
  AbiSet,
  type BlockExplorerClient,
  ZkSyncEraState,
  UpgradeChanges,
  lookupAndParse,
  type ZkSyncEraDiff,
} from ".";
import type { EnvBuilder } from "./env-builder.js";

type CreateDiffResponse = {
  diff: ZkSyncEraDiff;
  l1Abis: AbiSet;
  l1Client: BlockExplorerClient;
};

export async function compareCurrentStateWith(
  env: EnvBuilder,
  upgradeDirectory: string
): Promise<CreateDiffResponse> {
  const importer = env.importer()

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
    l1Abis,
    l1Client,
  };
}
