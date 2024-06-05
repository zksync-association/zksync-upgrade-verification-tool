import type {MemoryReport} from "../../reports/memory-report";
import type {MemoryValue} from "./memory-value";
import type {Hex} from "viem";

export class BooleanValue implements MemoryValue {
  val: boolean

  constructor (val: boolean) {
    this.val = val
  }

  writeInto (report: MemoryReport): void {
    report.addBoolean(this.val)
  }
}