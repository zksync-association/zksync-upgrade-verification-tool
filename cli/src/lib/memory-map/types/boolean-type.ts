import type {MemoryDataType} from "./data-type";
import {MemorySnapshot} from "../memory-snapshot";
import {Option} from "nochoices";

export class BooleanType implements MemoryDataType {
  private offset: number;

  constructor (offset: number) {
    this.offset = offset
  }

  extract (memory: MemorySnapshot, slot: bigint): Option<string> {
    return memory.at(slot)
      .map(buf => buf[buf.length - this.offset - 1])
      .map(byte => byte === 0 ? "false" : "true");
  }

  get evmSize (): number {
    return 1;
  }
}