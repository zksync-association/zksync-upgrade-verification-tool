import type { MemoryDataType } from "./data-type";
import type { Option } from "nochoices";
import { bytesToHex, type Hex } from "viem";

import type { StorageSnapshot } from "../snapshot/storage-snapshot";
import { AddressValue } from "../values/address-value";
import type { StorageValue } from "../values/storage-value";

export class AddressType implements MemoryDataType {
  async extract(memory: StorageSnapshot, slot: bigint, _offset = 0): Promise<Option<StorageValue>> {
    const mayne = await memory.at(slot);
    return mayne.map(this.format).map((str) => new AddressValue(str));
  }

  format(data: Buffer): Hex {
    const sub = data.subarray(data.length - 20, data.length);
    return bytesToHex(sub);
  }

  get evmSize(): number {
    return 20;
  }
}
