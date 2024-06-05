import type {MemoryReport} from "../../reports/memory-report";

export interface MemoryValue {
  writeInto(report: MemoryReport): void
}