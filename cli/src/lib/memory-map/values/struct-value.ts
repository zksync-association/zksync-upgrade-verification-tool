import type {MemoryValue} from "./memory-value";
import type {MemoryReport} from "../../reports/memory-report";

export type ValueField = {
  key: string,
  value: MemoryValue
}

export class StructValue implements MemoryValue {
  fields: ValueField[]
  constructor (fields: ValueField[]) {
    this.fields = fields
  }

  writeInto<T> (report: MemoryReport<T>): T {
    return report.writeStruct(this.fields);
  }

}