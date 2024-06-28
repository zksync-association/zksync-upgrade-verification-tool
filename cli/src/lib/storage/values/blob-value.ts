import type { StorageValue } from "./storage-value";
import type { StorageReport } from "../../reports/storage-report";

export class BlobValue implements StorageValue {
  private buf: Buffer;

  constructor(buf: Buffer) {
    this.buf = buf;
  }

  writeInto<T>(report: StorageReport<T>): T {
    return report.writeBuf(this.buf);
  }
}
