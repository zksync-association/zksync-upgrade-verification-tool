import type { MemoryReport } from "../../reports/memory-report";
import type { MemoryValue } from "./memory-value";

export class BooleanValue implements MemoryValue {
  val: boolean;

  constructor(val: boolean) {
    this.val = val;
  }

  writeInto<T>(report: MemoryReport<T>): T {
    return report.addBoolean(this.val);
  }
}
