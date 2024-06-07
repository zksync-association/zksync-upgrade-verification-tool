import type { PropertyChange } from "../storage/property-change";
import chalk from "chalk";
import { bytesToHex, type Hex } from "viem";
import type { MemoryValue } from "../storage/values/memory-value";
import type { ValueField } from "../storage/values/struct-value";

export interface MemoryReport<T> {
  add(change: PropertyChange): void;
  addAddress(addr: Hex): T;
  addBigNumber(n: bigint): T;
  writeBuf(buf: Buffer): T;
  addBoolean(val: boolean): T;

  addArray(inner: MemoryValue[]): T;

  writeEmpty(): T;

  writeStruct(fields: ValueField[]): T;

  writeMapping(fields: ValueField[]): T;
}

export class StringMemoryReport implements MemoryReport<string> {
  lines: string[];
  private colored: boolean;
  constructor(colored = true) {
    this.lines = [];
    this.colored = colored;
  }

  private bold(text: string): string {
    if (this.colored) {
      return chalk.bold(text);
    }
    return text;
  }

  add(change: PropertyChange) {
    this.lines.push("--------------------------");
    this.lines.push(`name: ${this.bold(change.prop.name)}`);
    this.lines.push(`description: ${change.prop.description}`);
    this.lines.push("");
    this.lines.push("before:");
    this.lines.push(`  ${change.before.map((v) => v.writeInto(this)).unwrapOr("No content.")}`);
    this.lines.push("");
    this.lines.push("after:");
    this.lines.push(`  ${change.after.map((v) => v.writeInto(this)).unwrapOr("No content.")}`);
    this.lines.push("--------------------------");
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

  addArray(inner: MemoryValue[]): string {
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
        const lines = value.writeInto(this).split('\n')
        return `.${key}: ${lines.join(`\n${" ".repeat(key.length + 3)}`)}`
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

  isEmpty (): boolean {
    return this.lines.length === 0
  }
}
