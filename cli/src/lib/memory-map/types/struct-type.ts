import type { MemoryDataType } from "./data-type";
import { Option } from "nochoices";

import type { MemorySnapshot } from "../memory-snapshot";
import type {MemoryValue} from "../values/memory-value";
import {StructValue} from "../values/struct-value";
import {EmptyValue} from "../values/empty-value";

type StructField = { name: string; type: MemoryDataType };
export class StructType implements MemoryDataType {
  private fields: StructField[];

  constructor(fields: StructField[]) {
    this.fields = fields;
  }

  extract(memory: MemorySnapshot, slot: bigint): Option<MemoryValue> {
    let acum = 0;
    // let current = memory.at(slot).unwrapOr(Buffer.alloc(32).fill(0))
    let slotPosition = 0n;
    const extractedValues = []
    for (const { name, type } of this.fields) {
      if (acum + type.evmSize > 32) {
        slotPosition += 1n;
        acum = 0;
      }

      extractedValues.push({
        key: name,
        value: type.extract(memory, slot + slotPosition)
      })

      acum += type.evmSize;
    }

    if (extractedValues.map(r => r.value).every((r) => r.isNone())) {
      return Option.None();
    }

    const res = extractedValues.map(t => ({
      key: t.key,
      value: t.value.unwrapOr(new EmptyValue())
    }))
    return Option.Some(new StructValue(res));
  }

  get evmSize(): number {
    return this.fields.map((field) => field.type.evmSize).reduce((a, b) => a + b);
  }
}
