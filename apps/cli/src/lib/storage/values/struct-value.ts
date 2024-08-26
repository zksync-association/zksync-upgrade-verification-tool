import type { StorageValue } from "./storage-value";
import type { StorageVisitor } from "../../reports/storage-visitor";

export type ValueField = {
  key: string;
  value: StorageValue;
};

export class StructValue implements StorageValue {
  fields: ValueField[];
  constructor(fields: ValueField[]) {
    this.fields = fields;
  }

  accept<T>(report: StorageVisitor<T>): T {
    return report.visitStruct(this.fields);
  }
}
