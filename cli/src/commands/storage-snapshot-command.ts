import type {EnvBuilder} from "../lib/env-builder";
import {RpcStorageSnapshot} from "../lib/storage/rpc-storage-snapshot";
import {SnapshotReport} from "../lib/reports/storage-snapshot-report";
import {Property} from "../lib/storage/property";
import {AddressType} from "../lib/storage/types/address-type";
import {mainDiamondProps} from "../lib/storage/storage-props";

export async function storageSnapshotCommand (env: EnvBuilder): Promise<void> {
  const rpc = env.rpcL1()
  const snapshot = new RpcStorageSnapshot(rpc, "0x32400084C286CF3E17e7B677ea9583e60a000324")
  const report = new SnapshotReport(snapshot, mainDiamondProps([], []))

  console.log(await report.format())
}