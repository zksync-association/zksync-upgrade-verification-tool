import type { MemoryDataType } from "./data-type";
import type { Option } from "nochoices";

import type { MemorySnapshot } from "../memory-snapshot";
import type { MemoryValue } from "../values/memory-value";
import { BlobValue } from "../values/blob-value";

export class BlobType implements MemoryDataType {
  private size: number;
  constructor(size = 32) {
    this.size = size;
  }

  extract(memory: MemorySnapshot, slot: bigint, offset = 0): Option<MemoryValue> {
    return memory
      .at(slot)
      .map((buf) => new BlobValue(buf.subarray(32 - offset - this.size, 32 - offset)));
  }

  get evmSize(): number {
    return this.size;
  }
}
