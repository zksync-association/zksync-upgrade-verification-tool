import {Option} from "nochoices";

import {MemorySnapshot} from "../memory-snapshot";

export interface MemoryDataType {
  extract (memory: MemorySnapshot, slot: bigint): Option<string>

  get evmSize (): number
}