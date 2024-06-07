import type { MemoryDataType } from "./data-type";
import type { Option } from "nochoices";
import { bytesToBigInt } from "viem";

import type { MemorySnapshot } from "../memory-snapshot";
import {BigNumberValue} from "../values/big-number-value";
import type {MemoryValue} from "../values/memory-value";

export class BigNumberType implements MemoryDataType {
  private size: number;

  constructor (size = 32) {
    this.size = size;
  }

  extract (memory: MemorySnapshot, slot: bigint, offset: number = 0): Option<MemoryValue> {
    const start = 32 - offset - this.size;
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
