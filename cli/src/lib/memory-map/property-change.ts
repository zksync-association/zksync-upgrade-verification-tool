import {Property} from "./property";
import {Option} from "nochoices";

export class PropertyChange {
  prop: Property
  before: Option<string>
  after: Option<string>

  constructor (
    prop: Property,
    before: Option<string>,
    after: Option<string>
  ) {
    this.prop = prop
    this.before = before
    this.after = after
  }
}