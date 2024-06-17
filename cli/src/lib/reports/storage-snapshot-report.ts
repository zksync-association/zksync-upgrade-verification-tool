import type { StorageReport } from "./storage-report";
import type { StorageSnapshot } from "../storage/storage-snapshot";
import type { Property } from "../storage/property";
import { bytesToHex, type Hex } from "viem";
import type { StorageValue } from "../storage/values/storage-value";
import type { ValueField } from "../storage/values/struct-value";

export class SnapshotReport implements StorageReport<string> {
  private lines: string[];
  private snapshot: StorageSnapshot;

  constructor(snapshot: StorageSnapshot) {
    this.snapshot = snapshot;
    this.lines = [];
  }

  add(prop: Property): void {
    prop.extract(this.snapshot).ifSome((value) => {
      this.lines.push("----------");
      this.lines.push(`name: ${prop.name}`);
      this.lines.push(`description: ${prop.description}\n`);

      this.lines.push(`value: ${value}`);
      this.lines.push("----------");
    });
  }

  format(): string {
    return this.lines.join("\n");
  }

  addAddress(addr: Hex): string {
    return addr;
  }

  addBigNumber(n: bigint): string {
    return n.toString();
  }

  writeBuf(buf: Buffer): string {
    return bytesToHex(buf);
  }

  addBoolean(val: boolean): string {
    return val ? "true" : "false";
  }

  addArray(inner: StorageValue[]): string {
    return inner
      .map((v) => v.writeInto(this))
      .map((str) => `- ${str}`)
      .join("\n  ");
  }

  writeEmpty(): string {
    return "Empty slot.";
  }

  writeStruct(fields: ValueField[]): string {
    return fields
      .map(({ key, value }) => {
        const lines = value.writeInto(this).split("\n");
        return `.${key}: ${lines.join(`\n${" ".repeat(key.length + 3)}`)}`;
      })
      .join("\n  ");
  }

  writeMapping(fields: ValueField[]): string {
    return fields
      .map(({ key, value }) => {
        const lines = value.writeInto(this).split("\n");
        const formated = lines.join(`\n${" ".repeat(key.length + 4)}`);
        return `[${key}]: ${formated}`;
      })
      .join("\n  ");
  }
}
