import type { Option } from "nochoices";

import type { StorageSnapshot } from "../snapshot";
import type { StorageValue } from "../values/storage-value.js";

export interface MemoryDataType {
  extract(memory: StorageSnapshot, slot: bigint, offset: number): Promise<Option<StorageValue>>;

  get evmSize(): number;
}
