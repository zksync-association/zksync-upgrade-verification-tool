import type {MemoryDataType} from "./types/data-type";
import {Option} from "nochoices";

import {MemorySnapshot} from "./memory-snapshot";

export class Property {
  name: string
  slot: bigint
  description: string
  type: MemoryDataType

  constructor (
    name: string,
    slot: bigint,
    description: string,
    type: MemoryDataType
  ) {
    this.name = name
    this.slot = slot
    this.description = description
    this.type = type
  }

  extract (memory: MemorySnapshot): Option<string> {
    return this.type.extract(memory, this.slot)
  }
}