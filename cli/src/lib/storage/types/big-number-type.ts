import type { MemoryDataType } from "./data-type";
import type { Option } from "nochoices";
import { bytesToBigInt } from "viem";

import type { StorageSnapshot } from "../storage-snapshot";
import { BigNumberValue } from "../values/big-number-value";
import type { StorageValue } from "../values/storage-value";

export class BigNumberType implements MemoryDataType {
  private size: number;

  constructor(size = 32) {
    this.size = size;
  }

  async extract(memory: StorageSnapshot, slot: bigint, offset = 0): Promise<Option<StorageValue>> {
    const start = 32 - offset - this.size;
    const maybe = await memory.at(slot);
    return maybe
      .map((buf) => buf.subarray(start, start + this.size))
      .map(bytesToBigInt)
      .map((n) => new BigNumberValue(n));
  }

  get evmSize(): number {
    return this.size;
  }
}
