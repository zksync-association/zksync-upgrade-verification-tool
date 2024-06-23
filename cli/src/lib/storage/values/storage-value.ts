import type { StorageVisitor } from "../../reports/storage-visitor";

export interface StorageValue {
  accept<T>(report: StorageVisitor<T>): T;
}
