import type { StorageValue } from "./storage-value";
import type { StorageReport } from "../../reports/storage-report";
import type { ValueField } from "./struct-value";

export class MappingValue implements StorageValue {
  fields: ValueField[];
  constructor(fields: ValueField[]) {
    this.fields = fields;
  }

  writeInto<T>(report: StorageReport<T>): T {
    return report.writeMapping(this.fields);
  }
}
