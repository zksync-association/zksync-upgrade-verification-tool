import type {MemoryDiffRaw} from "../schema/rpc";
import {Option} from "nochoices";

class Property {
  name: string
  slot: number
  description: string
  type: string

  constructor (
    name: string,
    slot: number,
    description: string,
    type: string
  ) {
    this.name = name
    this.slot = slot
    this.description = description
    this.type = type
  }

  format (): string {
    return ""
  }

  private formatedSlot (): string {
    return `0x${this.slot.toString(16).padStart(64, '0')}`
  }

  extract (pre: Record<string, string>): Option<string> {
    return Option.fromNullable(pre[this.formatedSlot()]);
  }
}

const allProps = [
  new Property("Storage.__DEPRECATED_diamondCutStorage", 0, "[DEPRECATED] Storage of variables needed for deprecated diamond cut facet", "FixedArray"),
  new Property("Storage.governor", 7, "Address which will exercise critical changes to the Diamond Proxy (upgrades, freezing & unfreezing)", "address"),
  new Property("Storage.l2DefaultAccountBytecodeHash", 24, "Bytecode hash of default account (bytecode for EOA). Used as an input to zkp-circuit.", "LongNumber")
]

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


export class MemoryMap {
  pre: Record<string, string>
  post: Record<string, string>

  constructor (diff: MemoryDiffRaw, addr: string) {
    const pre = diff.result.pre[addr]
    const post = diff.result.post[addr]

    if (!pre || !pre.storage) {
      throw new Error("missing pre")
    }

    if (!post || !post.storage) {
      throw new Error("missing post")
    }

    this.pre = pre.storage
    this.post = post.storage
  }

  // toReport (): string {
  //   const table = new CliTable()
  //   return ""
  // }

  changeFor (propName: string): Option<PropertyChange> {
    const maybe = Option.fromNullable(allProps.find(p => p.name === propName))
    return maybe.map(prop => new PropertyChange(
        prop,
        prop.extract(this.pre),
        prop.extract(this.post)
      )
    )
  }
}