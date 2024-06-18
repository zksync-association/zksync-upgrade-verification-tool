import type { MemoryValue } from "./memory-value";
import type { StorageReport } from "../../reports/storage-report";

export type ValueField = {
  key: string;
  value: MemoryValue;
};

export class StructValue implements MemoryValue {
  fields: ValueField[];
  constructor(fields: ValueField[]) {
    this.fields = fields;
  }

  writeInto<T>(report: StorageReport<T>): T {
    return report.writeStruct(this.fields);
  }
}
