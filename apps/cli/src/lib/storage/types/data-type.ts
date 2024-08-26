import type { Option } from "nochoices";

import type { StorageSnapshot } from "../snapshot/index.js";
import type { StorageValue } from "../values/storage-value.js";

export interface MemoryDataType {
  extract(memory: StorageSnapshot, slot: bigint, offset: number): Promise<Option<StorageValue>>;

  get evmSize(): number;
}
