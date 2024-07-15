import type { StorageVisitor } from "./storage-visitor";
import { bytesToHex, type Hex } from "viem";
import type { StorageValue } from "../storage/values/storage-value";
import type { ValueField } from "../storage/values/struct-value";
import { zodHex } from "../../schema/hex-parser";
import { z } from "zod";

type FacetsToSelectsValue =
  Hex |
  Hex[] |
  Map<Hex, Hex[]>

export class FacetsToSelectorsVisitor implements StorageVisitor<FacetsToSelectsValue> {
  value: Map<Hex, Hex[]>
  nextList: Hex[]

  constructor() {
    this.value = new Map()
    this.nextList = []
  }

  visitAddress(addr: Hex): FacetsToSelectsValue {
    throw new Error("not implemented")
  }

  visitBigNumber(n: bigint): FacetsToSelectsValue {
    throw new Error("not implemented")
  }

  visitBuf(buf: Buffer): FacetsToSelectsValue {
    return bytesToHex(buf)
  }

  visitBoolean(val: boolean): FacetsToSelectsValue {
    throw new Error("not implemented")
  }

  visitArray(inner: StorageValue[]): Hex[] {
    return inner.map(v => {
      const data = v.accept(this)
      return zodHex.parse(data)
    })
  }

  visitEmpty(): FacetsToSelectsValue {
    throw new Error("not implemented")
  }

  visitStruct(fields: ValueField[]): FacetsToSelectsValue {
    const field = fields.find(f => f.key === "selectors")
    if (!field) {
      throw new Error("selectors should be present")
    }
    return z.array(zodHex).parse(field.value.accept(this))
  }

  visitMapping(fields: ValueField[]): Map<Hex, Hex[]> {
    const map = new Map<Hex, Hex[]>()

    for (const field of fields) {
      const value = field.value.accept(this) as Hex[]
      map.set(field.key as Hex, value)
    }
    return map
  }
}
