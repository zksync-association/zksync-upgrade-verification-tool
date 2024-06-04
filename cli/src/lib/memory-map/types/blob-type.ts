import type { MemoryDataType } from "./data-type";
import type { Option } from "nochoices";
import { bytesToHex } from "viem";

import type { MemorySnapshot } from "../memory-snapshot";

export class BlobType implements MemoryDataType {
  extract(memory: MemorySnapshot, slot: bigint): Option<string> {
    return memory
      .at(slot)
      .map(this.format)
      .map((str) => str.toLowerCase());
  }

  format(data: Buffer): string {
    return bytesToHex(data, { size: 32 });
  }

  get evmSize(): number {
    return 32;
  }
}
