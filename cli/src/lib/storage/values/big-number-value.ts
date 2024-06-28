import type { StorageValue } from "./storage-value";
import type { StorageReport } from "../../reports/storage-report";

export class BigNumberValue implements StorageValue {
  n: bigint;

  constructor(n: bigint) {
    this.n = n;
  }

  writeInto<T>(report: StorageReport<T>): T {
    return report.addBigNumber(this.n);
  }
}
