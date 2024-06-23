import type { StorageValue } from "./storage-value";
import type { StorageVisitor } from "../../reports/storage-visitor";

export class EmptyValue implements StorageValue {
  accept<T>(report: StorageVisitor<T>): T {
    return report.visitEmpty();
  }
}
