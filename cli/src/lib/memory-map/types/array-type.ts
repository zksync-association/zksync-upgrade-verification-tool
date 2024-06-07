import type {MemoryDataType} from "./data-type";
import type {MemorySnapshot} from "../memory-snapshot";
import {Option} from "nochoices";
import {bytesToBigint} from "viem/utils";
import {hexToBigInt, keccak256, numberToBytes, numberToHex} from "viem";
import type {MemoryValue} from "../values/memory-value";
import {ArrayValue} from "../values/array-value";
import {EmptyValue} from "../values/empty-value";

export class ArrayType implements MemoryDataType {
  private inner: MemoryDataType;

  constructor (inner: MemoryDataType) {
    this.inner = inner;
  }

  extract (memory: MemorySnapshot, slot: bigint, _offset: number = 0): Option<MemoryValue> {
    const res: Option<MemoryValue>[] = [];
    const base = hexToBigInt(keccak256(numberToBytes(slot, {size: 32})));
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


    let offset = 0;
    let slotDelta = 0n
    for (let i = 0n; i < length; i++) {
      if (offset + this.inner.evmSize > 32) {
        offset = 0
        slotDelta += 1n
      }

      res.push(this.inner.extract(memory, base + slotDelta, offset));
      offset += this.inner.evmSize
    }

    return Option.Some(new ArrayValue(res.map(v => v.unwrapOr(new EmptyValue()))));
  }

  get evmSize (): number {
    return 32;
  }
}
