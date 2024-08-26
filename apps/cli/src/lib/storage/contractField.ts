import type { MemoryDataType } from "./types/data-type.js";
import type { Option } from "nochoices";

import type { StorageSnapshot } from "./snapshot/index.js";
import type { StorageValue } from "./values/storage-value.js";

export class ContractField {
  name: string;
  slot: bigint;
  description: string;
  type: MemoryDataType;
  private offset: number;

  constructor(name: string, slot: bigint, description: string, type: MemoryDataType, offset = 0) {
    this.name = name;
    this.slot = slot;
    this.description = description;
    this.type = type;
    this.offset = offset;
  }

  async extract(memory: StorageSnapshot): Promise<Option<StorageValue>> {
    return this.type.extract(memory, this.slot, this.offset);
  }
}
