import type { StorageVisitor } from "./storage-visitor";
import { bytesToHex, type Hex } from "viem";
import type { StorageValue } from "../storage/values/storage-value";
import type { ValueField } from "../storage/values/struct-value";
import { zodHex } from "../../schema/hex-parser";
import { z } from "zod";

type FacetsToSelectorsValue = Hex | Hex[] | Map<Hex, Hex[]>;

export class FacetsToSelectorsVisitor implements StorageVisitor<FacetsToSelectorsValue> {
  value: Map<Hex, Hex[]>;
  nextList: Hex[];

  constructor() {
    this.value = new Map();
    this.nextList = [];
  }

  visitAddress(addr: Hex): FacetsToSelectorsValue {
    throw new Error("not implemented");
  }

  visitBigNumber(n: bigint): FacetsToSelectorsValue {
    throw new Error("not implemented");
  }

  visitBuf(buf: Buffer): FacetsToSelectorsValue {
    return bytesToHex(buf);
  }

  visitBoolean(val: boolean): FacetsToSelectorsValue {
    throw new Error("not implemented");
  }

  visitArray(inner: StorageValue[]): Hex[] {
    return inner.map((v) => {
      const data = v.accept(this);
      return zodHex.parse(data);
    });
  }

  visitEmpty(): FacetsToSelectorsValue {
    throw new Error("not implemented");
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
