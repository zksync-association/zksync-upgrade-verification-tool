import type { StorageVisitor } from "../../reports/storage-visitor";

export interface StorageValue {
  accept<T>(visitor: StorageVisitor<T>): T;
}
