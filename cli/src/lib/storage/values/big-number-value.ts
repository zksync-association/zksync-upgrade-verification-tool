import type { MemoryValue } from "./memory-value";
import type { StorageReport } from "../../reports/storage-report";

export class BigNumberValue implements MemoryValue {
  n: bigint;

  constructor(n: bigint) {
    this.n = n;
  }

  writeInto<T>(report: StorageReport<T>): T {
    return report.addBigNumber(this.n);
  }
}
