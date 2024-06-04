import type {MemoryDataType} from "./data-type";
import {Option} from "nochoices";

import {MemorySnapshot} from "../memory-snapshot";

type StructField = { name: string, type: MemoryDataType }
export class StructType implements MemoryDataType {
  private fields: StructField[];

  constructor (fields: StructField[]) {
    this.fields = fields
  }

  extract (memory: MemorySnapshot, slot: bigint): Option<string> {
    let acum = 0
    // let current = memory.at(slot).unwrapOr(Buffer.alloc(32).fill(0))
    let slotPosition = 0n
    const res: Record<string, Option<string>> = {}
    for (const {name, type} of this.fields) {
      if (acum + type.evmSize > 32) {
        // current = memory.at(slot + slotPosition).unwrapOr(Buffer.alloc(32).fill(0))
        slotPosition += 1n
        acum = 0
      }

      res[name] = type.extract(memory, slot + slotPosition)

      acum += type.evmSize
    }

    if (Object.values(res).every(r => r.isNone())) {
      return Option.None()
    }

    const content = []

    for (const key in res) {
      const value = res[key]
      content.push(`${key}=>${value.unwrapOr("No content.")}`)
    }

    return Option.Some(`{${content.join(',')}}`)
  }

  get evmSize (): number {
    return this.fields.map(field => field.type.evmSize).reduce((a, b) => a + b);
  }
}