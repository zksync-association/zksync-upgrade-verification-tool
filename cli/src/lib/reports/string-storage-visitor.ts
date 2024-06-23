import type {StorageVisitor} from "./storage-visitor";
import {bytesToHex, type Hex} from "viem";
import type {StorageValue} from "../storage/values/storage-value";
import type {ValueField} from "../storage/values/struct-value";

export class StringStorageVisitor implements StorageVisitor<string> {
  visitAddress(addr: Hex): string {
    return ` ${addr}`;
  }

  visitBigNumber(n: bigint): string {
    return ` ${n.toString()}`;
  }

  visitBuf(buf: Buffer): string {
    return ` ${bytesToHex(buf)}`;
  }

  visitBoolean(val: boolean): string {
    return val ? " true" : " false";
  }

  visitArray(inner: StorageValue[]): string {
    const lines = inner.map((v) => v.accept(this)).map((str) => `-${str}`);
    return ["", ...lines].join("\n  ");
  }

  visitEmpty(): string {
    return " Empty slot.";
  }

  visitStruct(fields: ValueField[]): string {
    const lines = fields.map(({ key, value }) => {
      const lines = value.accept(this).split("\n");
      return `.${key}:${lines.join("\n  ")}`;
    });
    return ["", ...lines].join("\n  ");
  }

  visitMapping(fields: ValueField[]): string {
    const lines = fields.map(({ key, value }) => {
      const lines = value.accept(this).split("\n");
      const formated = lines.join("\n  ");
      return `[${key}]:${formated}`;
    });
    return ["", ...lines].join("\n  ");
  }
}