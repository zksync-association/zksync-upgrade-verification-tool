import type { StorageReport } from "../../reports/storage-report";

export interface MemoryValue {
  writeInto<T>(report: StorageReport<T>): T;
}
