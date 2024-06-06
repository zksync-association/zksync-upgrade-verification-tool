import type { MemoryDataType } from "./data-type";
import type { MemorySnapshot } from "../memory-snapshot";
import { Option } from "nochoices";
import { bytesToBigint } from "viem/utils";
import {hexToBigInt, keccak256, numberToBytes, numberToHex} from "viem";
import type {MemoryValue} from "../values/memory-value";
import {ArrayValue} from "../values/array-value";

export class ArrayType implements MemoryDataType {
  private inner: MemoryDataType;

  constructor(inner: MemoryDataType) {
    this.inner = inner;
  }

  extract(memory: MemorySnapshot, slot: bigint): Option<MemoryValue> {
    const res: Option<MemoryValue>[] = [];
    const base = hexToBigInt(keccak256(numberToBytes(slot, { size: 32 })));
    const coso = numberToHex(base)
    const length = memory
      .at(slot)
      .map((buf) => bytesToBigint(buf))
      .unwrapOrElse(() => {
        let res = 0n;
        while (memory.at(base + res).isSome()) {
          res += 1n;
        }

        return res;
      });

    for (let i = 0n; i < length; i++) {
      res.push(this.inner.extract(memory, base + i));
    }

    return Option.Some(new ArrayValue(res.map(v => v.unwrap())));
  }

  get evmSize(): number {
    return 32;
  }
}
