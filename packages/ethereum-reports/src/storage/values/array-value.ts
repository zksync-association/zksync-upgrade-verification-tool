import type { StorageValue } from "./storage-value.js";
import type { StorageVisitor } from "../../reports/storage-visitor.js";

export class ArrayValue implements StorageValue {
  inner: StorageValue[];

  constructor(inner: StorageValue[]) {
    this.inner = inner;
  }

  accept<T>(report: StorageVisitor<T>): T {
    return report.visitArray(this.inner);
  }
}
