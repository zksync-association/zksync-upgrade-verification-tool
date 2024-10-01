import type { StorageValue } from "./storage-value.js";
import type { StorageVisitor } from "../../reports/storage-visitor.js";
import type { ValueField } from "./struct-value.js";

export class MappingValue implements StorageValue {
  fields: ValueField[];
  constructor(fields: ValueField[]) {
    this.fields = fields;
  }

  accept<T>(visitor: StorageVisitor<T>): T {
    return visitor.visitMapping(this.fields);
  }
}
