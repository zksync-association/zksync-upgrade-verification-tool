import type { Hex } from "viem";
import type { StorageValue } from "../storage/values/storage-value";
import type { ValueField } from "../storage/values/struct-value";
import type { Property } from "../storage/property";

export interface StorageReport<T> {
  addAddress(addr: Hex): T;
  addBigNumber(n: bigint): T;
  writeBuf(buf: Buffer): T;
  addBoolean(val: boolean): T;

  addArray(inner: StorageValue[]): T;

  writeEmpty(): T;

  writeStruct(fields: ValueField[]): T;

  writeMapping(fields: ValueField[]): T;
}
