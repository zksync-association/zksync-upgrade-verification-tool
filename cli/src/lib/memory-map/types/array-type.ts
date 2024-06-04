import type {MemoryDataType} from "./data-type";
import {MemorySnapshot} from "../memory-snapshot";
import {Option} from "nochoices";
import {bytesToBigint} from "viem/utils";
import {hexToBigInt, keccak256, numberToBytes} from "viem";


export class ArrayType implements MemoryDataType {
  private inner: MemoryDataType;

  constructor (inner: MemoryDataType) {
    this.inner = inner
  }

  extract (memory: MemorySnapshot, slot: bigint): Option<string> {
    const res = []
    const base = hexToBigInt(keccak256(numberToBytes(slot)))

    const length = memory
      .at(slot)
      .map(buf => bytesToBigint(buf))
      .unwrapOrElse(() => {
        let res = 0n
        while (memory.at(base + res).isSome()) {
          res += 1n
        }

        return res
      });

    for (let i = 0n; i < length; i++) {
      res.push(this.inner.extract(memory, base + i))
    }

    const content = res.map(opt => opt.unwrapOr("0x0")).join(",")
    return Option.Some(`[${content}]`);
  }

  get evmSize (): number {
    return 32;
  }
}