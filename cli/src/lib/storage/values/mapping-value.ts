import type { StorageValue } from "./storage-value";
import type { StorageVisitor } from "../../reports/storage-visitor";
import type { ValueField } from "./struct-value";

export class MappingValue implements StorageValue {
  fields: ValueField[];
  constructor(fields: ValueField[]) {
    this.fields = fields;
  }

  accept<T>(visitor: StorageVisitor<T>): T {
    return visitor.visitMapping(this.fields);
  }
}
