import { DIAMOND_ADDRS } from "@repo/common/ethereum";
import { ZksyncEraState } from "../reports/zksync-era-state";
import type { EnvBuilder } from "../lib/env-builder.js";
import { RpcStorageSnapshot } from "../reports/storage/snapshot";
import { SnapshotReport } from "../reports/reports/storage-snapshot-report";
import { mainDiamondFields } from "../reports/storage/storage-props";

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
