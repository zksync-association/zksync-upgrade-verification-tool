import type { MemoryDataType } from "./data-type";
import type { MemorySnapshot } from "../memory-snapshot";
import { Option } from "nochoices";
import type { MemoryValue } from "../values/memory-value";
import { ArrayValue } from "../values/array-value";
import { EmptyValue } from "../values/empty-value";

export class FixedArrayType implements MemoryDataType {
  private size: number;
  inner: MemoryDataType;

  constructor(size: number, inner: MemoryDataType) {
    this.size = size;
    this.inner = inner;
  }

  extract(memory: MemorySnapshot, slot: bigint, _offset: number): Option<MemoryValue> {
    const slots = new Array(this.size).fill(0).map((_, i) => slot + BigInt(i));

    const content = slots.map((slot) => this.inner.extract(memory, slot, 0));

    if (content.every((s) => s.isNone())) {
      return Option.None();
    }

    return Option.Some(new ArrayValue(content.map((o) => o.unwrapOr(new EmptyValue()))));
  }

  get evmSize(): number {
    return this.inner.evmSize * this.size;
  }
}
