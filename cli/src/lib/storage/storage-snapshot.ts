import {Option} from "nochoices";

export interface StorageSnapshot {
  at(pos: bigint): Option<Buffer>;
}
