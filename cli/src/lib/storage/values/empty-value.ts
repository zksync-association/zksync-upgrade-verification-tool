import type { StorageValue } from "./storage-value";
import type { StorageReport } from "../../reports/storage-report";

export class EmptyValue implements StorageValue {
  writeInto<T>(report: StorageReport<T>): T {
    return report.writeEmpty();
  }
}
