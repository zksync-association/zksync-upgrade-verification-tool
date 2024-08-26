import { bytesToBigInt, type Hex } from "viem";
import { Option } from "nochoices";
import type { StorageSnapshot } from "./storage-snapshot";

export class RecordStorageSnapshot implements StorageSnapshot {
  data: Map<bigint, Buffer>;

  constructor(raw: Record<string, Hex>) {
    this.data = new Map();
    for (const [key, value] of Object.entries(raw)) {
      const keyHex = Buffer.from(key.substring(2, 67), "hex");
      const valueHex = Buffer.from(value.substring(2, 67), "hex");
      this.data.set(bytesToBigInt(keyHex), valueHex);
    }
  }

  async at(pos: bigint): Promise<Option<Buffer>> {
    return Option.fromNullable(this.data.get(pos));
  }
}
