import type { StorageValue } from "./storage-value";
import type { StorageVisitor } from "../../reports/storage-visitor";
import type { ValueField } from "./struct-value";

export class MappingValue implements StorageValue {
  fields: ValueField[];
  constructor(fields: ValueField[]) {
    this.fields = fields;
  }

  accept<T>(report: StorageVisitor<T>): T {
    return report.visitMapping(this.fields);
  }
}
