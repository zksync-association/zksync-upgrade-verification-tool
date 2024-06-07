import type { MemoryDataType } from "./data-type";
import type { MemorySnapshot } from "../memory-snapshot";
import type { Option } from "nochoices";
import type {MemoryValue} from "../values/memory-value";
import {BooleanValue} from "../values/boolean-value";
import {bytesToBigInt} from "viem";

export class BooleanType implements MemoryDataType {
  extract (memory: MemorySnapshot, slot: bigint, offset: number = 0): Option<MemoryValue> {
    return memory
      .at(slot)
      .map((buf) => buf[buf.length - offset - 1])
      .map((num) => new BooleanValue(num !== 0))
  }

  get evmSize(): number {
    return 1;
  }
}
