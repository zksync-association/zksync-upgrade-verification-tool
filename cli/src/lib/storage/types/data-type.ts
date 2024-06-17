import type { Option } from "nochoices";

import type { StorageSnapshot } from "../storage-snapshot";
import type { StorageValue } from "../values/storage-value";

export interface MemoryDataType {
  extract(memory: StorageSnapshot, slot: bigint, offset: number): Option<StorageValue>;

  get evmSize(): number;
}
