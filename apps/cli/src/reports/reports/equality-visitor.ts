import type { StorageVisitor } from "./storage-visitor";
import type { Hex } from "viem";
import type { StorageValue } from "../storage/values/storage-value";
import { StructValue, type ValueField } from "../storage/values/struct-value";
import { AddressValue } from "../storage/values/address-value";
import { ArrayValue } from "../storage/values/array-value";
import { BigNumberValue } from "../storage/values/big-number-value";
import { BooleanValue } from "../storage/values/boolean-value";
import { BlobValue } from "../storage/values/blob-value";
import { EmptyValue } from "../storage/values/empty-value";
import { MappingValue } from "../storage/values/mapping-value";

function zip<U, V>(arr1: U[], arr2: V[]): [U, V][] {
  const res: Array<[U, V]> = [];

  for (let i = 0; i < arr1.length; i++) {
    if (arr1[i] === undefined) {
      break;
    }
    if (arr2[i] === undefined) {
      break;
    }

    res.push([arr1[i] as U, arr2[i] as V]);
  }

  return res;
}

export class EqualityVisitor<T extends StorageValue> implements StorageVisitor<boolean> {
  private value: T;
  constructor(value: T) {
    this.value = value;
  }

  visitAddress(addr: Hex): boolean {
    return this.value instanceof AddressValue && this.value.addr === addr;
  }

  visitArray(inner: StorageValue[]): boolean {
    if (this.value instanceof ArrayValue) {
      return (
        inner.length === this.value.inner.length &&
        zip(this.value.inner, inner).every(([a, b]) => a.accept(new EqualityVisitor(b)))
      );
    }
    return false;
  }

  visitBigNumber(n: bigint): boolean {
    return this.value instanceof BigNumberValue && this.value.n === n;
  }

  visitBoolean(val: boolean): boolean {
    return this.value instanceof BooleanValue && this.value.val === val;
  }

  visitBuf(buf: Buffer): boolean {
    return this.value instanceof BlobValue && Buffer.compare(this.value.buf, buf) === 0;
  }

  visitEmpty(): boolean {
    return this.value instanceof EmptyValue;
  }

  visitMapping(fields: ValueField[]): boolean {
    if (this.value instanceof MappingValue) {
      return (
        fields.length === this.value.fields.length &&
        zip(this.value.fields, fields).every(
          ([a, b]) => a.key === b.key && a.value.accept(new EqualityVisitor(b.value))
        )
      );
    }
    return false;
  }

  visitStruct(fields: ValueField[]): boolean {
    if (this.value instanceof StructValue) {
      return (
        fields.length === this.value.fields.length &&
        zip(this.value.fields, fields).every(
          ([a, b]) => a.key === b.key && a.value.accept(new EqualityVisitor(b.value))
        )
      );
    }
    return false;
  }
}
