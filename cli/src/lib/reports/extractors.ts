import { bytesToHex, type Hex } from "viem";
import type { StorageVisitor } from "./storage-visitor";
import type { StorageValue } from "../storage/values/storage-value";
import type { ValueField } from "../storage/values/struct-value";
import { zodHex } from "../../schema/zod-optionals";
import { z } from "zod";

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
  visitBigNumber(n: bigint): bigint {
    return n;
  }
}

export class BlobExtractor extends ValueExtractor<Hex> {
  visitBuf(buf: Buffer): Hex {
    return bytesToHex(buf);
  }
}

export class AddressExtractor extends ValueExtractor<Hex> {
  visitAddress(addr: Hex): Hex {
    return addr;
  }
}

export class ListOfAddressesExtractor extends ValueExtractor<Hex[]> {
  visitAddress(addr: Hex): Hex[] {
    return [addr];
  }

  visitArray(inner: StorageValue[]): Hex[] {
    return inner.flatMap((v) => v.accept(this));
  }

  visitEmpty(): Hex[] {
    return [];
  }
}

type FacetsToSelectorsValue = Hex | Hex[] | Map<Hex, Hex[]>;

export class FacetsToSelectorsVisitor extends ValueExtractor<FacetsToSelectorsValue> {
  visitBuf(buf: Buffer): FacetsToSelectorsValue {
    return bytesToHex(buf);
  }

  visitArray(inner: StorageValue[]): Hex[] {
    return inner.map((v) => {
      const data = v.accept(this);
      return zodHex.parse(data);
    });
  }

  visitEmpty(): FacetsToSelectorsValue {
    return [];
  }

  visitStruct(fields: ValueField[]): FacetsToSelectorsValue {
    const field = fields.find((f) => f.key === "selectors");
    if (!field) {
      throw new Error("selectors should be present");
    }
    return z.array(zodHex).parse(field.value.accept(this));
  }

  visitMapping(fields: ValueField[]): Map<Hex, Hex[]> {
    const map = new Map<Hex, Hex[]>();

    for (const field of fields) {
      const value = field.value.accept(this) as Hex[];
      map.set(field.key as Hex, value);
    }
    return map;
  }
}
