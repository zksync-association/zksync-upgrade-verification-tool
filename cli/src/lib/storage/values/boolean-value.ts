import type { StorageReport } from "../../reports/storage-report";
import type { MemoryValue } from "./memory-value";

export class BooleanValue implements MemoryValue {
  val: boolean;

  constructor(val: boolean) {
    this.val = val;
  }

  writeInto<T>(report: StorageReport<T>): T {
    return report.addBoolean(this.val);
  }
}
