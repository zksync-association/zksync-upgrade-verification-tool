import type { StorageVisitor } from "../../reports/storage-visitor.js";

export interface StorageValue {
  accept<T>(visitor: StorageVisitor<T>): T;
}
