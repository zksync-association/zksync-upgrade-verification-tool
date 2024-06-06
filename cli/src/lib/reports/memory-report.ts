import  {type PropertyChange} from "../memory-map/property-change";
import chalk from "chalk";
import {bytesToHex, type Hex} from "viem";

export interface MemoryReport<T> {
  add(change: PropertyChange): void
  addAddress(addr: Hex): T
  addBigNumber (n: bigint): T;
  writeBuf (buf: Buffer): T;
  addBoolean (val: boolean): T;
}

export class StringMemoryReport implements MemoryReport<string>{
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
    this.lines.push(`  ${change.before.map(v => v.writeInto(this)).unwrapOr("No content.")}`)
    this.lines.push("")
    this.lines.push('after:')
    this.lines.push(`  ${change.after.map(v => v.writeInto(this)).unwrapOr("No content.")}`)
    this.lines.push("--------------------------")
  }

  format (): string {
    return this.lines.join("\n")
  }

  addAddress (addr: Hex): string {
    return addr
  }

  addBigNumber (n: bigint): string {
    return n.toString()
  }

  writeBuf (buf: Buffer): string {
    return bytesToHex(buf)
  }

  addBoolean (val: boolean): string {
    return val ? "true" : "false"
  }
}
