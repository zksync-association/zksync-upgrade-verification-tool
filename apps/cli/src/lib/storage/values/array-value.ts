import type { StorageValue } from "./storage-value";
import type { StorageVisitor } from "../../reports/storage-visitor";

export class ArrayValue implements StorageValue {
  inner: StorageValue[];

  constructor(inner: StorageValue[]) {
    this.inner = inner;
  }

  accept<T>(report: StorageVisitor<T>): T {
    return report.visitArray(this.inner);
  }
}
