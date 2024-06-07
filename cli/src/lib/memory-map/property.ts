import type { MemoryDataType } from "./types/data-type";
import type { Option } from "nochoices";

import type { MemorySnapshot } from "./memory-snapshot";
import type { MemoryValue } from "./values/memory-value";

export class Property {
  name: string;
  slot: bigint;
  description: string;
  type: MemoryDataType;

  constructor(name: string, slot: bigint, description: string, type: MemoryDataType) {
    this.name = name;
    this.slot = slot;
    this.description = description;
    this.type = type;
  }

  extract(memory: MemorySnapshot): Option<MemoryValue> {
    return this.type.extract(memory, this.slot, 0);
  }
}
