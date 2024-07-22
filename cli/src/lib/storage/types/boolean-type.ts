import type { MemoryDataType } from "./data-type";
import type { StorageSnapshot } from "../snapshot/storage-snapshot";
import type { Option } from "nochoices";
import type { StorageValue } from "../values/storage-value";
import { BooleanValue } from "../values/boolean-value";

export class BooleanType implements MemoryDataType {
  async extract(memory: StorageSnapshot, slot: bigint, offset = 0): Promise<Option<StorageValue>> {
    const maybe = await memory.at(slot);
    return maybe
      .map((buf) => buf[buf.length - offset - 1])
      .map((num) => new BooleanValue(num !== 0));
  }

  get evmSize(): number {
    return 1;
  }
}
