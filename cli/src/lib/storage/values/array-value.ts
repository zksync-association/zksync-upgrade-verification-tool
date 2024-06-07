import type { MemoryValue } from "./memory-value";
import type { StorageReport } from "../../reports/storage-report";

export class ArrayValue implements MemoryValue {
  inner: MemoryValue[];

  constructor(inner: MemoryValue[]) {
    this.inner = inner;
  }

  writeInto<T>(report: StorageReport<T>): T {
    return report.addArray(this.inner);
  }
}
