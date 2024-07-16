import type { StorageVisitor } from "./storage-visitor";
import type { Hex } from "viem";
import type { StorageValue } from "../storage/values/storage-value";
import type { ValueField } from "../storage/values/struct-value";

export class ValueExtractor<T> implements StorageVisitor<T> {
  visitAddress(_addr: Hex): T {
    throw new Error("Not implemented");
  }

  visitArray(_inner: StorageValue[]): T {
    throw new Error("Not implemented");
  }

  visitBigNumber(_n: bigint): T {
    throw new Error("Not implemented");
  }

  visitBoolean(_val: boolean): T {
    throw new Error("Not implemented");
  }

  visitBuf(_buf: Buffer): T {
    throw new Error("Not implemented");
  }

  visitEmpty(): T {
    throw new Error("Not implemented");
  }

  visitMapping(_fields: ValueField[]): T {
    throw new Error("Not implemented");
  }

  visitStruct(_fields: ValueField[]): T {
    throw new Error("Not implemented");
  }
}
