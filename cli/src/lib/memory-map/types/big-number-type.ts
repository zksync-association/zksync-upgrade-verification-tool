import type {MemoryDataType} from "./data-type";
import {Option} from "nochoices";
import {bytesToBigInt} from "viem";

import {MemorySnapshot} from "../memory-snapshot";

export class BigNumberType implements MemoryDataType {
  private size: number;
  private offset: number;

  constructor (size = 32, offset = 0) {
    this.size = size
    this.offset = offset
  }

  extract (memory: MemorySnapshot, slot: bigint): Option<string> {
    const start = 32 - this.offset - this.size
    return memory.at(slot)
      .map(buf => buf.subarray(start, start + this.size))
      .map(bytesToBigInt)
      .map(int => int.toString());
  }

  get evmSize (): number {
    return this.size;
  }
}