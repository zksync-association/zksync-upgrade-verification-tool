import type { StorageVisitor } from "./storage-visitor.js";
import { bytesToHex, type Hex } from "viem";
import type { StorageValue } from "../storage/values/storage-value.js";
import type { ValueField } from "../storage/values/struct-value.js";

export type ExtractedMapping = {
  type: "mapping";
  entries: {
    key: string;
    value: ExtractedValue;
  }[];
};

export type ExtractedStruct = {
  type: "struct";
  fields: {
    key: string;
    value: ExtractedValue;
  }[];
};

export type ExtractedAddress = {
  type: "address";
  value: string;
};

export type ExtractedNumber = {
  type: "numeric";
  value: string;
};

export type ExtractedBlob = {
  type: "blob";
  value: string;
};

export type ExtractedArray = {
  type: "array";
  value: ExtractedValue[];
};

export type ExtractedBoolean = {
  type: "boolean";
  value: boolean;
};

export type ExtractedEmpty = {
  type: "empty";
};

export type ExtractedValue =
  | ExtractedAddress
  | ExtractedNumber
  | ExtractedBlob
  | ExtractedArray
  | ExtractedMapping
  | ExtractedStruct
  | ExtractedBoolean
  | ExtractedEmpty;

export class ObjStorageVisitor implements StorageVisitor<ExtractedValue> {
  visitAddress(addr: Hex): ExtractedValue {
    return {
      type: "address",
      value: addr,
    };
  }

  visitBigNumber(n: bigint): ExtractedValue {
    return {
      type: "numeric",
      value: n.toString(),
    };
  }

  visitBuf(buf: Buffer): ExtractedValue {
    return {
      type: "blob",
      value: bytesToHex(buf),
    };
  }

  visitBoolean(val: boolean): ExtractedValue {
    return {
      type: "boolean",
      value: val,
    };
  }

  visitEmpty(): ExtractedValue {
    return { type: "empty" };
  }

  visitArray(inner: StorageValue[]): ExtractedValue {
    return {
      type: "array",
      value: inner.map((v) => v.accept(this)),
    };
  }

  visitStruct(fields: ValueField[]): ExtractedValue {
    return {
      type: "struct",
      fields: fields.map((f) => {
        return {
          key: f.key,
          value: f.value.accept(this),
        };
      }),
    };
  }

  visitMapping(fields: ValueField[]): ExtractedValue {
    return {
      type: "mapping",
      entries: fields.map((f) => {
        return {
          key: f.key,
          value: f.value.accept(this),
        };
      }),
    };
  }
}
