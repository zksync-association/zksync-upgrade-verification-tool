import { bytesToBigInt } from "viem";
import { Option } from "nochoices";

export interface StorageSnapshot {
  at(pos: bigint): Option<Buffer>;
}

export class FileStorageSnapshot implements StorageSnapshot {
  data: Map<bigint, Buffer>;

  constructor(raw: Record<string, string>) {
    this.data = new Map();
    const keys = Object.keys(raw);

    for (const key of keys) {
      const keyHex = Buffer.from(key.substring(2, 67), "hex");
      const valueHex = Buffer.from(raw[key].substring(2, 67), "hex");
      this.data.set(bytesToBigInt(keyHex), valueHex);
    }
  }

  at(pos: bigint): Option<Buffer> {
    return Option.fromNullable(this.data.get(pos));
  }
}
