import type { StorageValue } from "./storage-value";
import type { StorageVisitor } from "../../reports/storage-visitor";

export class BlobValue implements StorageValue {
  private buf: Buffer;

  constructor(buf: Buffer) {
    this.buf = buf;
  }

  accept<T>(report: StorageVisitor<T>): T {
    return report.visitBuf(this.buf);
  }
}
