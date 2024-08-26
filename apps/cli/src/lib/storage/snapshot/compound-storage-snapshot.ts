import type { StorageSnapshot } from "./storage-snapshot.js";
import type { Option } from "nochoices";

export class CompoundStorageSnapshot implements StorageSnapshot {
  base: StorageSnapshot;
  outerLayer: StorageSnapshot;

  constructor(base: StorageSnapshot, outerLayer: StorageSnapshot) {
    this.base = base;
    this.outerLayer = outerLayer;
  }

  async at(pos: bigint): Promise<Option<Buffer>> {
    const outerValue = await this.outerLayer.at(pos);
    if (outerValue.isSome()) {
      return outerValue;
    }

    return this.base.at(pos);
  }
}
