import type { StorageVisitor } from "./storage-visitor";
import type { Hex } from "viem";
import type { StorageValue } from "../storage/values/storage-value";
import type { ValueField } from "../storage/values/struct-value";

export class ListOfAddressesVisitor implements StorageVisitor<Hex[]> {
  visitAddress(addr: Hex): Hex[] {
    return [addr];
  }

  visitBigNumber(_n: bigint): Hex[] {
    throw new Error("Unexpected number");
  }

  visitBuf(_buf: Buffer): Hex[] {
    throw new Error("Unexpected buffer");
  }

  visitBoolean(_val: boolean): Hex[] {
    throw new Error("Unexpexted boolean");
  }

  visitArray(inner: StorageValue[]): Hex[] {
    return inner.flatMap((v) => v.accept(this));
  }

  visitEmpty(): Hex[] {
    return [];
  }

  visitStruct(_fields: ValueField[]): Hex[] {
    throw new Error("Struct not expected.");
  }

  visitMapping(_fields: ValueField[]): Hex[] {
    throw new Error("Mapping not expected.");
  }
}
