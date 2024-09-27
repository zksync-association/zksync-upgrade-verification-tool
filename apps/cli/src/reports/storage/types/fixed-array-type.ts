import type { MemoryDataType } from "./data-type.js";
import type { StorageSnapshot } from "../snapshot";
import { Option } from "nochoices";
import type { StorageValue } from "../values/storage-value.js";
import { ArrayValue } from "../values/array-value.js";
import { EmptyValue } from "../values/empty-value.js";

export class FixedArrayType implements MemoryDataType {
  private size: number;
  inner: MemoryDataType;

  constructor(size: number, inner: MemoryDataType) {
    this.size = size;
    this.inner = inner;
  }

  async extract(
    memory: StorageSnapshot,
    slot: bigint,
    _offset: number
  ): Promise<Option<StorageValue>> {
    const slots = new Array(this.size).fill(0).map((_, i) => slot + BigInt(i));

    const content = await Promise.all(slots.map((slot) => this.inner.extract(memory, slot, 0)));

    if (content.every((s) => s.isNone())) {
      return Option.None();
    }

    return Option.Some(new ArrayValue(content.map((o) => o.unwrapOr(new EmptyValue()))));
  }

  get evmSize(): number {
    return this.inner.evmSize * this.size;
  }
}
