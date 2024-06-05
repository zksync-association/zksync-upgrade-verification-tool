import  {type PropertyChange} from "../memory-map/property-change";
import chalk from "chalk";
import {bytesToHex, type Hex} from "viem";

export interface MemoryReport {
  add(change: PropertyChange): void
  addAddress(addr: Hex): void
  addBigNumber (n: bigint): void;
  writeBuf (buf: Buffer): void;
  addBoolean (val: boolean): void;
}

export class StringMemoryReport implements MemoryReport{
  lines: string[]
  constructor () {
    this.lines = []
  }

  add(change: PropertyChange) {
    this.lines.push("--------------------------")
    this.lines.push(`name: ${chalk.bold(change.prop.name)}`)
    this.lines.push(`description: ${change.prop.description}`)
    this.lines.push("")
    this.lines.push('before:')
    this.lines.push(`  `)
    change.before.map(v => v.writeInto(this)).ifNone(() => {
      const lastLineIndex = this.lines.length - 1
      const line = this.lines[lastLineIndex]
      this.lines[lastLineIndex] = line.concat("Not present.")
    })
    this.lines.push("")
    this.lines.push('after:')
    this.lines.push("  ")
    change.after.map(v => v.writeInto(this)).ifNone(() => {
      const lastLineIndex = this.lines.length - 1
      const line = this.lines[lastLineIndex]
      this.lines[lastLineIndex] = line.concat("Not present.")
    })
    this.lines.push("--------------------------")
  }

  format (): string {
    return this.lines.join("\n")
  }

  addAddress (addr: Hex): void {
    const lastLineIndex = this.lines.length - 1
    const line = this.lines[lastLineIndex]
    this.lines[lastLineIndex] = line.concat(addr)
  }

  addBigNumber (n: bigint): void {
    const lastLineIndex = this.lines.length - 1
    const line = this.lines[lastLineIndex]
    this.lines[lastLineIndex] = line.concat(n.toString())
  }

  writeBuf (buf: Buffer): void {
    const lastLineIndex = this.lines.length - 1
    const line = this.lines[lastLineIndex]
    this.lines[lastLineIndex] = line.concat(bytesToHex(buf))
  }

  addBoolean (val: boolean): void {
    const lastLineIndex = this.lines.length - 1
    const line = this.lines[lastLineIndex]
    this.lines[lastLineIndex] = line.concat(val ? "true" : "false")
  }
}
