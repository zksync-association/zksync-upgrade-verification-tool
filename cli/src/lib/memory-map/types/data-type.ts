import type { Option } from "nochoices";

import type { MemorySnapshot } from "../memory-snapshot";

export interface MemoryDataType {
  extract(memory: MemorySnapshot, slot: bigint): Option<string>;

  get evmSize(): number;
}
