import type { MemoryDataType } from "./data-type";
import type { StorageSnapshot } from "../storage-snapshot";
import { Option } from "nochoices";
import { bytesToBigint } from "viem/utils";
import { hexToBigInt, keccak256, numberToBytes } from "viem";
import type { StorageValue } from "../values/storage-value";
import { ArrayValue } from "../values/array-value";
import { EmptyValue } from "../values/empty-value";

export class ArrayType implements MemoryDataType {
  private inner: MemoryDataType;

  constructor(inner: MemoryDataType) {
    this.inner = inner;
  }

  extract(memory: StorageSnapshot, slot: bigint, _offset = 0): Option<StorageValue> {
    const res: Option<StorageValue>[] = [];
    const base = hexToBigInt(keccak256(numberToBytes(slot, { size: 32 })));
    return memory
      .at(slot)
      .map((buf) => bytesToBigint(buf))
      .orElse(() => {
        let res = 0n;
        while (memory.at(base + res).isSome()) {
          res += 1n;
        }

        return Option.Some(res).filter((n) => n !== 0n);
      })
      .map((length) => {
        let offset = 0;
        let slotDelta = 0n;
        for (let i = 0n; i < length; i++) {
          if (offset + this.inner.evmSize > 32) {
            offset = 0;
            slotDelta += 1n;
          }

          res.push(this.inner.extract(memory, base + slotDelta, offset));
          offset += this.inner.evmSize;
        }

        return new ArrayValue(res.map((v) => v.unwrapOr(new EmptyValue())));
      });
  }

  get evmSize(): number {
    return 32;
  }
}
