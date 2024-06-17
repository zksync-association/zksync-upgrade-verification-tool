import type {PropertyChange} from "../storage/property-change";
import {type Hex} from "viem";
import type {MemoryValue} from "../storage/values/memory-value";
import type {ValueField} from "../storage/values/struct-value";

export interface StorageReport<T> {
  add(change: PropertyChange): void;
  addAddress(addr: Hex): T;
  addBigNumber(n: bigint): T;
  writeBuf(buf: Buffer): T;
  addBoolean(val: boolean): T;

  addArray(inner: MemoryValue[]): T;

  writeEmpty(): T;

  writeStruct(fields: ValueField[]): T;

  writeMapping(fields: ValueField[]): T;
}

