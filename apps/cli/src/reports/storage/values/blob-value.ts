import type { StorageValue } from "./storage-value.js";
import type { StorageVisitor } from "../../reports/storage-visitor.js";

export class BlobValue implements StorageValue {
  buf: Buffer;

  constructor(buf: Buffer) {
    this.buf = buf;
  }

  accept<T>(report: StorageVisitor<T>): T {
    return report.visitBuf(this.buf);
  }
}
