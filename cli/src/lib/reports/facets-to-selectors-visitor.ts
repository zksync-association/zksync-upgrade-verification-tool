import type { StorageVisitor } from "./storage-visitor";
import { bytesToHex, type Hex } from "viem";
import type { StorageValue } from "../storage/values/storage-value";
import type { ValueField } from "../storage/values/struct-value";
import { zodHex } from "../../schema/hex-parser";

type XXX =
  Hex |
  Hex[] |
  Map<Hex, Hex[]>

export class FacetsToSelectorsVisitor implements StorageVisitor<XXX> {
  value: Map<Hex, Hex[]>
  nextList: Hex[]

  constructor() {
    this.value = new Map()
    this.nextList = []
  }

  extracted(): Map<Hex, Hex[]> {
    return this.value
  }

  visitAddress(addr: Hex): XXX {
    throw new Error("not implemented")
  }

  visitBigNumber(n: bigint): XXX {
    throw new Error("not implemented")
  }

  visitBuf(buf: Buffer): XXX {
    return bytesToHex(buf)
  }

  visitBoolean(val: boolean): XXX {
    throw new Error("not implemented")
  }

  visitArray(inner: StorageValue[]): Hex[] {
    return inner.map(v => {
      const data = v.accept(this)
      return zodHex.parse(data)
    })
  }

  visitEmpty(): XXX {
    throw new Error("not implemented")
  }

  visitStruct(fields: ValueField[]): XXX {
    const field = fields.find(f => f.key === "selectors")
    if (!field) {
      throw new Error("selectors should be present")
    }
    field.value.accept(this)
  }

  visitMapping(fields: ValueField[]): XXX {
    for (const field of fields) {
      field.value.accept(this)
      this.value.set(field.key as Hex, this.nextList)
      this.nextList = []
    }
  }
}
