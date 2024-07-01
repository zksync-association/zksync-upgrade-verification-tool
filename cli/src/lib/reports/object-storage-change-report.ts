import type { StorageChanges } from "../storage/storage-changes";
import { type ExtractedValue, ObjStorageVisitor } from "./obj-storage-visitor";

export type FieldStorageChange = {
  name: string;
  description: string;
  currentValue: ExtractedValue;
  proposedValue: ExtractedValue;
};

export class ObjectStorageChangeReport {
  private changes: StorageChanges;

  constructor(memoryMap: StorageChanges) {
    this.changes = memoryMap;
  }

  async format(): Promise<FieldStorageChange[]> {
    const changes = await this.changes.allChanges();
    const visitor = new ObjStorageVisitor();
    const res: FieldStorageChange[] = [];

    for (const change of changes) {
      res.push({
        name: change.prop.name,
        description: change.prop.description,
        currentValue: change.before.map((v) => v.accept(visitor)).unwrapOr({
          type: "empty",
        }),
        proposedValue: change.after.map((v) => v.accept(visitor)).unwrapOr({
          type: "empty",
        }),
      });
    }

    return res;
  }
}
