import type { StorageSnapshot } from "./storage-snapshot";
import { Option } from "nochoices";
import type { RpcClient } from "../rpc-client";
import { type Hex, hexToBytes } from "viem";

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
}
