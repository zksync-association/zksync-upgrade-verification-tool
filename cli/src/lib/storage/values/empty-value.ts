import type { MemoryValue } from "./memory-value";
import type { MemoryReport } from "../../reports/memory-report";

export class EmptyValue implements MemoryValue {
  writeInto<T>(report: MemoryReport<T>): T {
    return report.writeEmpty();
  }
}
