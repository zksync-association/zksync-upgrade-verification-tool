import type { StorageVisitor } from "../../reports/storage-visitor.js";
import type { StorageValue } from "./storage-value.js";
import type { Hex } from "viem";

export class AddressValue implements StorageValue {
  addr: Hex;

  constructor(addr: Hex) {
    this.addr = addr;
  }

  accept<T>(report: StorageVisitor<T>): T {
    return report.visitAddress(this.addr);
  }
}
