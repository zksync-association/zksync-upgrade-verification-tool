import { DIAMOND_ADDRS } from "@repo/common/ethereum";
import { SnapshotReport } from "@repo/ethereum-reports/reports/storage-snapshot-report";
import { RpcStorageSnapshot } from "@repo/ethereum-reports/storage/snapshot/rpc-storage-snapshot";
import { mainDiamondFields } from "@repo/ethereum-reports/storage/storage-props";
import { ZksyncEraState } from "@repo/ethereum-reports/zksync-era-state";
import type { EnvBuilder } from "../lib/env-builder.js";

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
