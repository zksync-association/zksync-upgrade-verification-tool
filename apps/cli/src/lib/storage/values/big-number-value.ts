import type { StorageValue } from "./storage-value.js";
import type { StorageVisitor } from "../../reports/storage-visitor.js";

export class BigNumberValue implements StorageValue {
  n: bigint;

  constructor(n: bigint) {
    this.n = n;
  }

  accept<T>(report: StorageVisitor<T>): T {
    return report.visitBigNumber(this.n);
  }
}
