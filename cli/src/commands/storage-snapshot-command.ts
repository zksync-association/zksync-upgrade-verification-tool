import type { EnvBuilder } from "../lib/env-builder";
import { RpcStorageSnapshot } from "../lib/storage/rpc-storage-snapshot";
import { SnapshotReport } from "../lib/reports/storage-snapshot-report";
import { mainDiamondFields } from "../lib/storage/storage-props";
import { DIAMOND_ADDRS } from "../lib";
import { CurrentZksyncEraState } from "../lib/current-zksync-era-state";

export async function storageSnapshotCommand(env: EnvBuilder): Promise<void> {
  const rpc = env.rpcL1();
  const snapshot = new RpcStorageSnapshot(rpc, DIAMOND_ADDRS[env.network]);

  const state = await CurrentZksyncEraState.fromBlockchain(
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
