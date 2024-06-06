import type {MemoryReport} from "../../reports/memory-report";

export interface MemoryValue {
  writeInto<T>(report: MemoryReport<T>): T
}