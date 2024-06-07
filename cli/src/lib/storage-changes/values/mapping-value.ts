import type { MemoryValue } from "./memory-value";
import type { MemoryReport } from "../../reports/memory-report";
import type { ValueField } from "./struct-value";

export class MappingValue implements MemoryValue {
  fields: ValueField[];
  constructor(fields: ValueField[]) {
    this.fields = fields;
  }

  writeInto<T>(report: MemoryReport<T>): T {
    return report.writeMapping(this.fields);
  }
}
