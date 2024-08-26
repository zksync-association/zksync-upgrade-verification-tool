import type { StorageValue } from "./storage-value.js";
import type { StorageVisitor } from "../../reports/storage-visitor.js";

export class EmptyValue implements StorageValue {
  accept<T>(report: StorageVisitor<T>): T {
    return report.visitEmpty();
  }
}
