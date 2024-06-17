import type { StorageReport } from "../../reports/storage-report";

export interface StorageValue {
  writeInto<T>(report: StorageReport<T>): T;
}
