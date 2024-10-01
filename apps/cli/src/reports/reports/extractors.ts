import { bytesToHex, type Hex } from "viem";
import type { StorageVisitor } from "./storage-visitor.js";
import type { StorageValue } from "../storage/values/storage-value.js";
import type { ValueField } from "../storage/values/struct-value.js";
import { z } from "zod";
import { hexSchema } from "@repo/common/schemas";

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

export class BigNumberExtractor extends ValueExtractor<bigint> {
  override visitBigNumber(n: bigint): bigint {
    return n;
  }
}

export class BlobExtractor extends ValueExtractor<Hex> {
  override visitBuf(buf: Buffer): Hex {
    return bytesToHex(buf);
  }
}

export class AddressExtractor extends ValueExtractor<Hex> {
  override visitAddress(addr: Hex): Hex {
    return addr;
  }
}

export class ListOfAddressesExtractor extends ValueExtractor<Hex[]> {
  override visitAddress(addr: Hex): Hex[] {
    return [addr];
  }

  override visitArray(inner: StorageValue[]): Hex[] {
    return inner.flatMap((v) => v.accept(this));
  }

  override visitEmpty(): Hex[] {
    return [];
  }
}

type FacetsToSelectorsValue = Hex | Hex[] | Map<Hex, Hex[]>;

export class FacetsToSelectorsVisitor extends ValueExtractor<FacetsToSelectorsValue> {
  override visitBuf(buf: Buffer): FacetsToSelectorsValue {
    return bytesToHex(buf);
  }

  override visitArray(inner: StorageValue[]): Hex[] {
    return inner.map((v) => {
      const data = v.accept(this);
      return hexSchema.parse(data);
    });
  }

  override visitEmpty(): FacetsToSelectorsValue {
    return [];
  }

  override visitStruct(fields: ValueField[]): FacetsToSelectorsValue {
    const field = fields.find((f) => f.key === "selectors");
    if (!field) {
      throw new Error("selectors should be present");
    }
    return z.array(hexSchema).parse(field.value.accept(this));
  }

  override visitMapping(fields: ValueField[]): Map<Hex, Hex[]> {
    const map = new Map<Hex, Hex[]>();

    for (const field of fields) {
      const value = field.value.accept(this) as Hex[];
      map.set(field.key as Hex, value);
    }
    return map;
  }
}
