import chalk from "chalk";
import { bytesToHex, type Hex } from "viem";
import type { StorageValue } from "../storage/values/storage-value";
import type { ValueField } from "../storage/values/struct-value";
import type { StorageReport } from "./storage-report";
import type { StorageChanges } from "../storage/storage-changes";

export class StringStorageChangeReport implements StorageReport<string> {
  lines: string[];
  private colored: boolean;
  private changes: StorageChanges;

  constructor (memoryMap: StorageChanges, colored = true) {
    this.lines = [];
    this.colored = colored;
    this.changes = memoryMap;
  }

  private bold(text: string): string {
    if (this.colored) {
      return chalk.bold(text);
    }
    return text;
  }

  async format(): Promise<string> {
    const changes = await this.changes.allChanges();
    const lines = [];

    for (const change of changes) {
      lines.push("--------------------------");
      lines.push(`name: ${this.bold(change.prop.name)}`);
      lines.push(`description: ${change.prop.description}`);
      lines.push("");
      lines.push("before:");
      lines.push(`  ${change.before.map((v) => v.writeInto(this)).unwrapOr("No content.")}`);
      lines.push("");
      lines.push("after:");
      lines.push(`  ${change.after.map((v) => v.writeInto(this)).unwrapOr("No content.")}`);
      lines.push("--------------------------");
    }

    return lines.join("\n");
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
    const sorted = fields.toSorted((a, b) => a.key.localeCompare(b.key))
    return sorted
      .map(({ key, value }) => {
        const lines = value.writeInto(this).split("\n");
        const formated = lines.join(`\n${" ".repeat(key.length + 4)}`);
        return `[${key}]: ${formated}`;
      })
      .join("\n  ");
  }
}
