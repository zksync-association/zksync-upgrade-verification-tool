import type { MemoryValue } from "./memory-value";
import type { StorageReport } from "../../reports/storage-report";

export class EmptyValue implements MemoryValue {
  writeInto<T>(report: StorageReport<T>): T {
    return report.writeEmpty();
  }
}
