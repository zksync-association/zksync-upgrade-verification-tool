import type { MemoryDataType } from "./data-type";
import type { Option } from "nochoices";
import { bytesToHex } from "viem";

import type { MemorySnapshot } from "../memory-snapshot";
import type {MemoryValue} from "../values/memory-value";
import type {MemoryReport} from "../../reports/memory-report";

class BlobValue implements MemoryValue {
  private buf: Buffer;
  constructor (buf: Buffer) {
    this.buf = buf
  }

  writeInto (report: MemoryReport): void {
    report.writeBuf(this.buf)
  }
}

export class BlobType implements MemoryDataType {
  extract(memory: MemorySnapshot, slot: bigint): Option<MemoryValue> {
    return memory
      .at(slot)
      .map(buf => new BlobValue(buf));
  }

  format(data: Buffer): string {
    return bytesToHex(data, { size: 32 });
  }

  get evmSize(): number {
    return 32;
  }
}
