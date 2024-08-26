import type { EnvBuilder } from "../lib/env-builder.js";
import { RpcStorageSnapshot } from "../lib/index.js";
import { SnapshotReport } from "../lib/reports/storage-snapshot-report.js";
import { mainDiamondFields } from "../lib/storage/storage-props.js";
import { DIAMOND_ADDRS } from "../lib/index.js";
import { ZksyncEraState } from "../lib/index.js";

export async function storageSnapshotCommand(env: EnvBuilder): Promise<void> {
  const rpc = env.rpcL1();
  const snapshot = new RpcStorageSnapshot(rpc, DIAMOND_ADDRS[env.network]);

  const state = await ZksyncEraState.fromBlockchain(
    env.network,
    env.l1Client(),
    await env.newRpcL1()
  );

  const report = new SnapshotReport(
    snapshot,
    mainDiamondFields(state.allSelectors(), state.allFacetsAddrs())
  );

  env.term().line(await report.format());
}
