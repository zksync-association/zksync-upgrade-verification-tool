import type { MemoryDataType } from "./data-type.js";
import type { Option } from "nochoices";

import type { StorageSnapshot } from "../snapshot/index.js";
import type { StorageValue } from "../values/storage-value.js";
import { BlobValue } from "../values/blob-value.js";

export class BlobType implements MemoryDataType {
  private size: number;
  constructor(size = 32) {
    this.size = size;
  }

  async extract(memory: StorageSnapshot, slot: bigint, offset = 0): Promise<Option<StorageValue>> {
    const maybe = await memory.at(slot);
    return maybe.map((buf) => new BlobValue(buf.subarray(32 - offset - this.size, 32 - offset)));
  }

  get evmSize(): number {
    return this.size;
  }
}
