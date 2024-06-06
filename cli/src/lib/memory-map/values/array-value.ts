import type {MemoryValue} from "./memory-value";
import type {MemoryReport} from "../../reports/memory-report";

export class ArrayValue implements MemoryValue {
  inner: MemoryValue[]

  constructor (inner: MemoryValue[]) {
    this.inner = inner
  }

  writeInto<T> (report: MemoryReport<T>): T {
    return report.addArray(this.inner);
  }
}