import type { StorageVisitor } from "../../reports/storage-visitor.js";
import type { StorageValue } from "./storage-value.js";

export class BooleanValue implements StorageValue {
  val: boolean;

  constructor(val: boolean) {
    this.val = val;
  }

  accept<T>(report: StorageVisitor<T>): T {
    return report.visitBoolean(this.val);
  }
}
