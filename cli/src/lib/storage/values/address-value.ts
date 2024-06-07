import type { StorageReport } from "../../reports/storage-report";
import type { MemoryValue } from "./memory-value";
import type { Hex } from "viem";

export class AddressValue implements MemoryValue {
  addr: Hex;

  constructor(addr: Hex) {
    this.addr = addr;
  }

  writeInto<T>(report: StorageReport<T>): T {
    return report.addAddress(this.addr);
  }
}
