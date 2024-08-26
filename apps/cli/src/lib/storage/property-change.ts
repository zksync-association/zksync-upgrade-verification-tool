import type { ContractField } from "./contractField.js";
import type { Option } from "nochoices";
import type { StorageValue } from "./values/storage-value.js";

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
