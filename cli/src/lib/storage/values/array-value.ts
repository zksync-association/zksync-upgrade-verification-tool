import type { StorageValue } from "./storage-value";
import type { StorageReport } from "../../reports/storage-report";

export class ArrayValue implements StorageValue {
  inner: StorageValue[];

  constructor(inner: StorageValue[]) {
    this.inner = inner;
  }

  writeInto<T>(report: StorageReport<T>): T {
    return report.addArray(this.inner);
  }
}
