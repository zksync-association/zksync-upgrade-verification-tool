import type { MemoryValue } from "./memory-value";
import type { StorageReport } from "../../reports/storage-report";

export class BlobValue implements MemoryValue {
  private buf: Buffer;

  constructor(buf: Buffer) {
    this.buf = buf;
  }

  writeInto<T>(report: StorageReport<T>): T {
    return report.writeBuf(this.buf);
  }
}
