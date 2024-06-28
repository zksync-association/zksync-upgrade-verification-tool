import type { StorageValue } from "./storage-value";
import type { StorageReport } from "../../reports/storage-report";

export type ValueField = {
  key: string;
  value: StorageValue;
};

export class StructValue implements StorageValue {
  fields: ValueField[];
  constructor(fields: ValueField[]) {
    this.fields = fields;
  }

  writeInto<T>(report: StorageReport<T>): T {
    return report.writeStruct(this.fields);
  }
}
