import type { Property } from "./property";
import type { Option } from "nochoices";
import type { MemoryValue } from "./values/memory-value";

export class PropertyChange {
  prop: Property;
  before: Option<MemoryValue>;
  after: Option<MemoryValue>;

  constructor(prop: Property, before: Option<MemoryValue>, after: Option<MemoryValue>) {
    this.prop = prop;
    this.before = before;
    this.after = after;
  }
}
