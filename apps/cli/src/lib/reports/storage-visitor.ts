import type { Hex } from "viem";
import type { StorageValue } from "../storage/values/storage-value";
import type { ValueField } from "../storage/values/struct-value";

export interface StorageVisitor<T> {
  visitAddress(addr: Hex): T;
  visitBigNumber(n: bigint): T;
  visitBuf(buf: Buffer): T;
  visitBoolean(val: boolean): T;
  visitArray(inner: StorageValue[]): T;
  visitEmpty(): T;
  visitStruct(fields: ValueField[]): T;
  visitMapping(fields: ValueField[]): T;
}
