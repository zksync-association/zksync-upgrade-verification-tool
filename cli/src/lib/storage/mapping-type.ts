import type { MemoryDataType } from "./types/data-type";
import { Option } from "nochoices";
import { bytesToHex, hexToBigInt, keccak256, numberToBytes } from "viem";

import type { StorageSnapshot } from "./storage-snapshot";
import type { StorageValue } from "./values/storage-value";
import { EmptyValue } from "./values/empty-value";
import { MappingValue } from "./values/mapping-value";

export class MappingType implements MemoryDataType {
  private keys: Buffer[];
  private valueType: MemoryDataType;
  private leftPadded: boolean;

  constructor(keys: Buffer[], valueType: MemoryDataType, leftPadded = false) {
    this.keys = keys;
    this.valueType = valueType;
    this.leftPadded = leftPadded;
  }

  extract(memory: StorageSnapshot, slot: bigint, _offset = 0): Option<StorageValue> {
    const bufSlot = numberToBytes(slot, { size: 32 });
    const values = this.keys.map((key) => {
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
        values: this.valueType.extract(memory, hexToBigInt(hashed), 0),
      };
    });

    if (values.every((v) => v.values.isNone())) {
      return Option.None();
    }

    const res = values.map((v) => ({
      key: v.key,
      value: v.values.unwrapOr(new EmptyValue()),
    }));

    return Option.Some(new MappingValue(res));

    // return Option.Some(
    //   values
    //     .filter((o) => o.isSome())
    //     .map((o) => o.unwrap())
    //     .join("\n")
    // );
  }

  get evmSize(): number {
    return 32;
  }
}
