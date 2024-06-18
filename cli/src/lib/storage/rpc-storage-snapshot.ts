import type {StorageSnapshot} from "./storage-snapshot";
import type {Option} from "nochoices";

export class RpcStorageSnapshot implements StorageSnapshot {
  async at(pos: bigint): Promise<Option<Buffer>> {
    return Promise.reject(new Error("Attempting to retrieve an attempt"));
  }
}