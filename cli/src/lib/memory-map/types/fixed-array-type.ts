import type { MemoryDataType } from "./data-type";
import type { MemorySnapshot } from "../memory-snapshot";
import { Option } from "nochoices";

export class FixedArrayType implements MemoryDataType {
  private size: number;
  inner: MemoryDataType;

  constructor(size: number, inner: MemoryDataType) {
    this.size = size;
    this.inner = inner;
  }

  extract(memory: MemorySnapshot, slot: bigint): Option<string> {
    const slots = new Array(this.size).fill(0).map((_, i) => slot + BigInt(i));

    const content = slots
      .map((slot) => this.inner.extract(memory, slot))
      .map((mayBeContent, i) => mayBeContent.map((str) => `[${i}]: ${str}`))
      .filter((mayBeContent) => mayBeContent.isSome())
      .map((maybeContent) => maybeContent.unwrap());

    return Option.Some(content)
      .filter((c) => c.length !== 0)
      .map((lines) => lines.join("\n"));
  }

  get evmSize(): number {
    return this.inner.evmSize * this.size;
  }
}
