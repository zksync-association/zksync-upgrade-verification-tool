import type {MemoryValue} from "./memory-value";
import type {MemoryReport} from "../../reports/memory-report";

export class BlobValue implements MemoryValue {
  private buf: Buffer;

  constructor (buf: Buffer) {
    this.buf = buf
  }

  writeInto<T> (report: MemoryReport<T>): T {
    return report.writeBuf(this.buf)
  }
}