import type { MemoryDataType } from "./data-type";
import type { Option } from "nochoices";
import { bytesToBigInt } from "viem";

import type { MemorySnapshot } from "../memory-snapshot";
import {BigNumberValue} from "../values/big-number-value";

export class BigNumberType implements MemoryDataType {
  private size: number;
  private offset: number;

  constructor(size = 32, offset = 0) {
    this.size = size;
    this.offset = offset;
  }

  extract(memory: MemorySnapshot, slot: bigint): Option<BigNumberValue> {
    const start = 32 - this.offset - this.size;
    return memory
      .at(slot)
      .map((buf) => buf.subarray(start, start + this.size))
      .map(bytesToBigInt)
      .map(n => new BigNumberValue(n))
  }

  get evmSize(): number {
    return this.size;
  }
}
