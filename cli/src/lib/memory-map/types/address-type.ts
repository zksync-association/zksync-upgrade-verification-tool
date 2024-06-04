import type { MemoryDataType } from "./data-type";
import type { Option } from "nochoices";
import { bytesToHex } from "viem";

import type { MemorySnapshot } from "../memory-snapshot";

export class AddressType implements MemoryDataType {
  extract(memory: MemorySnapshot, slot: bigint): Option<string> {
    return memory.at(slot).map(this.format);
  }

  format(data: Buffer): string {
    const sub = data.subarray(data.length - 20, data.length);
    return bytesToHex(sub);
  }

  get evmSize(): number {
    return 20;
  }
}
