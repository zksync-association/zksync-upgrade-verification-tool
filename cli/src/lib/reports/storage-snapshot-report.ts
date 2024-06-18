import type {StorageReport} from "./storage-report";
import type {StorageSnapshot} from "../storage/storage-snapshot";
import type {Property} from "../storage/property";
import {bytesToHex, type Hex} from "viem";
import type {StorageValue} from "../storage/values/storage-value";
import type {ValueField} from "../storage/values/struct-value";

export class SnapshotReport implements StorageReport<string> {
  private snapshot: StorageSnapshot;
  private props: Property[];

  constructor(snapshot: StorageSnapshot, props: Property[]) {
    this.snapshot = snapshot;
    this.props = props
  }

  async format(): Promise<string> {
    const lines: string[] = []

    for (const prop of this.props) {
      let extracted = await prop.extract(this.snapshot);
      extracted.ifSome((value) => {
        lines.push("----------");
        lines.push(`name: ${prop.name}`);
        lines.push(`description: ${prop.description}\n`);

        lines.push(`value:${this.inlineValue(value.writeInto(this))}`);
        lines.push("----------");
      });
    }

    return lines.join("\n");
  }

  private inlineValue(value: string): string {
    const tokens = ["\n", "[", "."]
    if(tokens.some(token => value.includes(token))) {
      return `\n  ${value}`
    }
    return ` ${value}`
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
      .map((str) => `-${this.inlineValue(str)}`)
      .join("\n  ");
  }

  writeEmpty(): string {
    return "Empty slot.";
  }

  writeStruct(fields: ValueField[]): string {
    return fields
      .map(({key, value}) => {
        const lines = this.inlineValue(value.writeInto(this)).split("\n");
        return `.${key}:${lines.join("\n  ")}`;
      })
      .join("\n  ");
  }

  writeMapping(fields: ValueField[]): string {
    return fields
      .map(({key, value}) => {
        const lines = value.writeInto(this).split("\n");
        const formated = lines.join("\n  ");
        return `[${key}]:${this.inlineValue(formated)}`;
      })
      .join("\n  ");
  }
}
