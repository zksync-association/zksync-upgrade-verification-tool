import type { MemoryValue } from "./memory-value";
import type { MemoryReport } from "../../reports/memory-report";

export class BigNumberValue implements MemoryValue {
  n: bigint;

  constructor(n: bigint) {
    this.n = n;
  }

  writeInto<T>(report: MemoryReport<T>): T {
    return report.addBigNumber(this.n);
  }
}
