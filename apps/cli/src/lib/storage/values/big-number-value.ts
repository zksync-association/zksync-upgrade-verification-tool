import type { StorageValue } from "./storage-value";
import type { StorageVisitor } from "../../reports/storage-visitor";

export class BigNumberValue implements StorageValue {
  n: bigint;

  constructor(n: bigint) {
    this.n = n;
  }

  accept<T>(report: StorageVisitor<T>): T {
    return report.visitBigNumber(this.n);
  }
}
