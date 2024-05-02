import {
  AbiSet,
  type BlockExplorerClient,
  ZkSyncEraState,
  UpgradeChanges,
  lookupAndParse,
  type ZkSyncEraDiff,
} from ".";
import path from "node:path";
import type { EnvBuilder } from "./env-builder.js";
import * as console from "node:console";

type CreateDiffResponse = {
  diff: ZkSyncEraDiff;
  l1Abis: AbiSet;
  l1Client: BlockExplorerClient;
};

export async function compareCurrentStateWith(
  env: EnvBuilder,
  upgradeDirectory: string
): Promise<CreateDiffResponse> {
  const upgrade = await lookupAndParse(upgradeDirectory, env.network);

  const l1Client = env.l1Client();
  const l1Abis = new AbiSet(l1Client);
  const zkSyncState = await ZkSyncEraState.create(env.network, l1Client, l1Abis, env.rpc());

  const changes = UpgradeChanges.fromFiles(
    upgrade.commonData,
    upgrade.transactions,
    upgrade.facets,
    upgrade.l2Upgrade
  );

  return {
    diff: await zkSyncState.calculateDiff(changes, l1Client),
    l1Abis,
    l1Client,
  };
}
