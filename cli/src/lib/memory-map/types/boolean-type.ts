import type { MemoryDataType } from "./data-type";
import type { MemorySnapshot } from "../memory-snapshot";
import type { Option } from "nochoices";

export class BooleanType implements MemoryDataType {
  private offset: number;

  constructor(offset = 0) {
    this.offset = offset;
  }

  extract(memory: MemorySnapshot, slot: bigint): Option<string> {
    return memory
      .at(slot)
      .map((buf) => buf[buf.length - this.offset - 1])
      .map((byte) => (byte === 0 ? "false" : "true"));
  }

  get evmSize(): number {
    return 1;
  }
}
