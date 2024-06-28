import type { ContractField } from "./contractField";
import type { Option } from "nochoices";
import type { StorageValue } from "./values/storage-value";

export class PropertyChange {
  prop: ContractField;
  before: Option<StorageValue>;
  after: Option<StorageValue>;

  constructor(prop: ContractField, before: Option<StorageValue>, after: Option<StorageValue>) {
    this.prop = prop;
    this.before = before;
    this.after = after;
  }
}
