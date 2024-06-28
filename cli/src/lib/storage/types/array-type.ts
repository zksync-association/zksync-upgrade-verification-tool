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

  async extract(
    storage: StorageSnapshot,
    slot: bigint,
    _offset = 0
  ): Promise<Option<StorageValue>> {
    const res: Option<StorageValue>[] = [];
    const base = hexToBigInt(keccak256(numberToBytes(slot, { size: 32 })));
    const lengthFromStorage = await storage
      .at(slot)
      .then((opt) => opt.map((buf) => bytesToBigint(buf)));
    const maybeLength = lengthFromStorage.isSome()
      ? lengthFromStorage
      : await this.calculateLength(storage, base);

    if (maybeLength.isNone()) {
      return Option.None();
    }

    const length = maybeLength.unwrap();

    let offset = 0;
    let slotDelta = 0n;
    for (let i = 0n; i < length; i++) {
      if (offset + this.inner.evmSize > 32) {
        offset = 0;
        slotDelta += 1n;
      }

      res.push(await this.inner.extract(storage, base + slotDelta, offset));
      offset += this.inner.evmSize;
    }

    return Option.Some(new ArrayValue(res.map((v) => v.unwrapOr(new EmptyValue()))));
  }

  get evmSize(): number {
    return 32;
  }

  private async calculateLength(memory: StorageSnapshot, base: bigint) {
    let res = 0n;
    while ((await memory.at(base + res)).isSome()) {
      res += 1n;
    }

    return Option.Some(res).filter((n) => n !== 0n);
  }
}
