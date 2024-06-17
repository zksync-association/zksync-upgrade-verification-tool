import type { Property } from "./property";
import type { Option } from "nochoices";
import type { StorageValue } from "./values/storage-value";

export class PropertyChange {
  prop: Property;
  before: Option<StorageValue>;
  after: Option<StorageValue>;

  constructor(prop: Property, before: Option<StorageValue>, after: Option<StorageValue>) {
    this.prop = prop;
    this.before = before;
    this.after = after;
  }
}
