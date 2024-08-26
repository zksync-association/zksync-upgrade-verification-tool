import type { MemoryDataType } from "./types/data-type.js";
import { Option } from "nochoices";
import { bytesToHex, hexToBigInt, keccak256, numberToBytes } from "viem";

import type { StorageSnapshot } from "./snapshot/index.js";
import type { StorageValue } from "./values/storage-value.js";
import { EmptyValue } from "./values/empty-value.js";
import { MappingValue } from "./values/mapping-value.js";

export class MappingType implements MemoryDataType {
  private keys: Buffer[];
  private valueType: MemoryDataType;
  private leftPadded: boolean;

  constructor(keys: Buffer[], valueType: MemoryDataType, leftPadded = false) {
    this.keys = keys;
    this.valueType = valueType;
    this.leftPadded = leftPadded;
  }

  async extract(memory: StorageSnapshot, slot: bigint, _offset = 0): Promise<Option<StorageValue>> {
    const bufSlot = numberToBytes(slot, { size: 32 });
    const values = await Promise.all(
      this.keys.map(async (key) => {
        const keyBuf = Buffer.alloc(32);
        if (this.leftPadded) {
          key.copy(keyBuf, keyBuf.length - key.length, 0);
        } else {
          key.copy(keyBuf, 0, 0, key.length);
        }

        const keySlot = Buffer.concat([keyBuf, bufSlot]);
        const hashed = keccak256(keySlot);

        return {
          key: bytesToHex(key),
          values: await this.valueType.extract(memory, hexToBigInt(hashed), 0),
        };
      })
    );

    if (values.every((v) => v.values.isNone())) {
      return Option.None();
    }

    const res = values.map((v) => ({
      key: v.key,
      value: v.values.unwrapOr(new EmptyValue()),
    }));

    return Option.Some(new MappingValue(res));
  }

  get evmSize(): number {
    return 32;
  }
}
