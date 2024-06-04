import type {MemoryDataType} from "./types/data-type";
import {Option} from "nochoices";
import {bytesToHex, hexToBigInt, keccak256, numberToBytes} from "viem";

import {MemorySnapshot} from "./memory-snapshot";

export class MappingType implements MemoryDataType {
  private keys: Buffer[];
  private valueType: MemoryDataType;

  constructor (keys: Buffer[], valueType: MemoryDataType) {
    this.keys = keys
    this.valueType = valueType
  }

  extract (memory: MemorySnapshot, slot: bigint): Option<string> {
    const bufSlot = numberToBytes(slot, {size: 32})
    const values = this.keys.map(key => {
      const keyBuf = Buffer.alloc(32)
      key.copy(keyBuf, 0, 0, key.length)
      const keySlot = Buffer.concat([keyBuf, bufSlot])

      const hashed = keccak256(keySlot)

      return this.valueType.extract(memory, hexToBigInt(hashed))
        .map(value => `[${bytesToHex(key)}]: ${value}`)
    })

    if (values.every(v => v.isNone())) {
      return Option.None()
    }

    return Option.Some(values
      .filter(o => o.isSome())
      .map(o => o.unwrap())
      .join("\n"));
  }

  get evmSize (): number {
    return 32;
  }
}