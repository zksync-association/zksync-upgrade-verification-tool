import type {EnvBuilder} from "../lib/env-builder";
import {RpcStorageSnapshot} from "../lib/storage/rpc-storage-snapshot";
import {SnapshotReport} from "../lib/reports/storage-snapshot-report";
import {mainDiamondProps} from "../lib/storage/storage-props";
import {ZkSyncEraState} from "../lib";

export async function storageSnapshotCommand (env: EnvBuilder): Promise<void> {
  const rpc = env.rpcL1()
  const snapshot = new RpcStorageSnapshot(rpc, "0x32400084C286CF3E17e7B677ea9583e60a000324")

  const state = await ZkSyncEraState.create(env.network, env.l1Client(), env.rpcL1(), env.rpcL2())

  const report = new SnapshotReport(snapshot, mainDiamondProps(state.allSelectors(), state.allFacetsAddresses()))

  console.log(await report.format())
}