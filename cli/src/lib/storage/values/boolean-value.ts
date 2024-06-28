import type { StorageReport } from "../../reports/storage-report";
import type { StorageValue } from "./storage-value";

export class BooleanValue implements StorageValue {
  val: boolean;

  constructor(val: boolean) {
    this.val = val;
  }

  writeInto<T>(report: StorageReport<T>): T {
    return report.addBoolean(this.val);
  }
}
