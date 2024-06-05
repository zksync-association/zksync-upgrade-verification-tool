import type {MemoryReport} from "../../reports/memory-report";
import type {MemoryValue} from "./memory-value";
import type {Hex} from "viem";

export class AddressValue implements MemoryValue {
  addr: Hex

  constructor (addr: Hex) {
    this.addr = addr
  }

  writeInto (report: MemoryReport): void {
    report.addAddress(this.addr)
  }
}