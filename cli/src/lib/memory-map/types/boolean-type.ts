import type { MemoryDataType } from "./data-type";
import type { MemorySnapshot } from "../memory-snapshot";
import type { Option } from "nochoices";
import type {MemoryValue} from "../values/memory-value";
import {BooleanValue} from "../values/boolean-value";
import {bytesToBigInt} from "viem";

export class BooleanType implements MemoryDataType {
  private offset: number;

  constructor(offset = 0) {
    this.offset = offset;
  }

  extract(memory: MemorySnapshot, slot: bigint): Option<MemoryValue> {
    return memory
      .at(slot)
      .map((buf) => new BooleanValue(bytesToBigInt(buf) !== 0n))
  }

  get evmSize(): number {
    return 1;
  }
}
