import type { StorageSnapshot } from "./storage-snapshot";
import { Option } from "nochoices";
import type { RpcClient } from "../rpc-client";
import { type Hex, hexToBigInt, hexToBytes } from "viem";

export class CompoundStorageSnapshot implements StorageSnapshot {
  base: StorageSnapshot
  outerLayer: StorageSnapshot

  constructor(base: StorageSnapshot, outerLayer: StorageSnapshot) {
    this.base = base
    this.outerLayer = outerLayer
  }

  async at(pos: bigint): Promise<Option<Buffer>> {
    const outerValue= await this.outerLayer.at(pos)
    if (outerValue.isSome()) {
      return outerValue
    }

    return this.base.at(pos)
  }
}

export class RpcStorageSnapshot implements StorageSnapshot {
  private rpc: RpcClient;
  private addr: Hex;

  constructor(rpc: RpcClient, addr: Hex) {
    this.rpc = rpc;
    this.addr = addr;
  }

  async at(pos: bigint): Promise<Option<Buffer>> {
    const hex = await this.rpc.storageRead(this.addr, pos);
    return Option.Some(Buffer.from(hexToBytes(hex)));
  }

  apply(layer: StorageSnapshot): StorageSnapshot {
    return new CompoundStorageSnapshot(this, layer)
  }
}
