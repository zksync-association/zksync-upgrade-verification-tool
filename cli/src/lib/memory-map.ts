import type {MemoryDiffRaw} from "../schema/rpc";
import {Option} from "nochoices";
import {bytesToHex, type Hex, hexToBigInt, hexToBytes, hexToNumber, numberToHex} from "viem";
import {undefined} from "zod";


interface MemoryDataType {
  extract (memory: Record<string, Hex>, slot: string): Option<string>
}

class AddressType implements MemoryDataType {
  extract (memory: Record<string, Hex>, slot: string): Option<string> {
    return Option.fromNullable(memory[slot])
      .map(this.format)
  }

  format (data: Hex): string {
    return bytesToHex(hexToBytes(data).slice(12));
  }
}

class HexFormat implements MemoryDataType {
  extract (memory: Record<string, Hex>, slot: string): Option<string> {
    return Option.fromNullable(memory[slot])
      .map(this.format)
      .map(str => str.toLowerCase())
  }

  format (data: Hex): string {
    return data
  }
}

class FixedArray implements MemoryDataType {
  private size: number;
  inner: MemoryDataType;

  constructor (size: number, inner: MemoryDataType) {
    this.size = size
    this.inner = inner
  }

  extract (memory: Record<string, Hex>, slot: Hex): Option<string> {
    const slots = new Array(this.size).fill(0).map((_, i) => BigInt(i) + hexToBigInt(slot))

    const content = slots
      .map(slot => this.inner.extract(memory, numberToHex(slot, {size: 32})))
      .map((mayBeContent, i) => mayBeContent.map(str => `[${i}]: ${str}`))
      .filter(mayBeContent => mayBeContent.isSome())
      .map(maybeContent => maybeContent.unwrap())

    return Option.Some(content)
      .filter(c => c.length !== 0)
      .map(lines => lines.join("\n"))
  }
}

class VerifierParamsType implements MemoryDataType {
  extract (memory: Record<string, Hex>, slot: Hex): Option<string> {
    const hex = new HexFormat()
    const keys = [
      "recursionNodeLevelVkHash",
      "recursionLeafLevelVkHash",
      "recursionCircuitsSetVksHash"
    ]

    const arr = keys.map<[string, Option<string>]>((name, i) => {
      const index = numberToHex(hexToNumber(slot) + i, { size: 32 });
      return [name, hex.extract(memory, index)]
    })

    if (!arr.some(([_name, opt]) => opt.isSome())) {
      return Option.None()
    }

    return Option.Some(
      arr.map(([name, opt]) => `[${name}]: ${opt.unwrapOr("Not affected")}`).join("\n")
    )
  }
}

class Property {
  name: string
  slot: string
  description: string
  type: MemoryDataType

  constructor (
    name: string,
    slot: string,
    description: string,
    type: MemoryDataType
  ) {
    this.name = name
    this.slot = slot
    this.description = description
    this.type = type
  }

  extract (memory: Record<string, Hex>): Option<string> {
    return this.type.extract(memory, this.slot)
  }
}

const allProps = [
  new Property(
    "Storage.__DEPRECATED_diamondCutStorage",
    numberToHex(0, {size: 32}),
    "[DEPRECATED] Storage of variables needed for deprecated diamond cut facet",
    new FixedArray(7, new AddressType())
  ),
  new Property(
    "Storage.governor",
    numberToHex(7, {size: 32}),
    "Address which will exercise critical changes to the Diamond Proxy (upgrades, freezing & unfreezing)",
    new AddressType()
  ),
  new Property(
    "Storage.verifier",
    numberToHex(10, {size: 32}),
    "Verifier contract. Used to verify aggregated proof for batches",
    new AddressType()
  ),
  new Property(
    "Storage.verifierParams",
    numberToHex(20, {size: 32}),
    "Bytecode hash of default account (bytecode for EOA). Used as an input to zkp-circuit.",
    new VerifierParamsType()
  ),
  new Property(
    "Storage.l2DefaultAccountBytecodeHash",
    numberToHex(24, {size: 32}),
    "Bytecode hash of default account (bytecode for EOA). Used as an input to zkp-circuit.",
    new HexFormat()
  )
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
  pre: Record<string, Hex>
  post: Record<string, Hex>

  constructor (diff: MemoryDiffRaw, addr: string) {
    const pre = diff.result.pre[addr]
    const post = diff.result.post[addr]

    if (!pre || !pre.storage) {
      throw new Error("missing pre")
    }

    if (!post || !post.storage) {
      throw new Error("missing post")
    }

    this.pre = pre.storage as Record<string, Hex>
    this.post = post.storage as Record<string, Hex>
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