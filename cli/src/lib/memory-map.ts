import type {MemoryDiffRaw} from "../schema/rpc";
import {Option} from "nochoices";
import {
  bytesToBigInt,
  bytesToHex,
  type Hex,
  hexToBigInt,
  hexToBytes,
  keccak256,
  numberToBytes,
  numberToHex
} from "viem";

interface MemoryDataType {
  extract (memory: MemorySnapshot, slot: bigint): Option<string>
}

class AddressType implements MemoryDataType {
  extract (memory: MemorySnapshot, slot: bigint): Option<string> {
    return memory.at(slot)
      .map(this.format)
  }

  format (data: bigint): string {
    return numberToHex(data, { size: 20 });
  }
}

class HexFormat implements MemoryDataType {
  extract (memory: MemorySnapshot, slot: bigint): Option<string> {
    return memory.at(slot)
      .map(this.format)
      .map(str => str.toLowerCase())
  }

  format (data: bigint): string {
    return numberToHex(data, { size: 32 })
  }
}

class SelectorMappingFormat implements MemoryDataType{
  private keys: Buffer[];
  constructor (keys: Buffer[]) {
    this.keys = keys
  }

  extract (memory: MemorySnapshot, slot: bigint): Option<string> {
    const bufSlot = numberToBytes(slot, { size: 32 })
    const values = this.keys.map(key => {
      const keyBuf = Buffer.alloc(32)
      key.copy(keyBuf, 0, 0, key.length)
      const keySlot = Buffer.concat([keyBuf, bufSlot])

      const hashed = keccak256(keySlot)
      // return memory.at(hexToBigInt(hashed)).map(v => v.toString())
      const addr = new AddressType()
      return addr.extract(memory, hexToBigInt(hashed))
        .map(value => `[${bytesToHex(key)}]: ${value}`)
    })
    return values[0];
  }
}

class FixedArray implements MemoryDataType {
  private size: number;
  inner: MemoryDataType;

  constructor (size: number, inner: MemoryDataType) {
    this.size = size
    this.inner = inner
  }

  extract (memory: MemorySnapshot, slot: bigint): Option<string> {
    const slots = new Array(this.size).fill(0).map((_, i) => slot + BigInt(i))

    const content = slots
      .map(slot => this.inner.extract(memory, slot))
      .map((mayBeContent, i) => mayBeContent.map(str => `[${i}]: ${str}`))
      .filter(mayBeContent => mayBeContent.isSome())
      .map(maybeContent => maybeContent.unwrap())

    return Option.Some(content)
      .filter(c => c.length !== 0)
      .map(lines => lines.join("\n"))
  }
}

class VerifierParamsType implements MemoryDataType {
  extract (memory: MemorySnapshot, slot: bigint): Option<string> {
    const hex = new HexFormat()
    const keys = [
      "recursionNodeLevelVkHash",
      "recursionLeafLevelVkHash",
      "recursionCircuitsSetVksHash"
    ]

    const arr = keys.map<[string, Option<string>]>((name, i) => {
      const index = slot + BigInt(i);
      return [name, hex.extract(memory, index)]
    })

    if (!arr.some(([_name, opt]) => opt.isSome())) {
      return Option.None()
    }

    return Option.Some(
      arr.map(([name, opt]) => `.${name}: ${opt.unwrapOr("Not affected")}`).join("\n")
    )
  }
}

class BigNumberType implements MemoryDataType {
  extract (memory: MemorySnapshot, slot: bigint): Option<string> {
    return memory.at(slot).map(value => value.toString()) ;
  }
}

class Property {
  name: string
  slot: bigint
  description: string
  type: MemoryDataType

  constructor (
    name: string,
    slot: bigint,
    description: string,
    type: MemoryDataType
  ) {
    this.name = name
    this.slot = slot
    this.description = description
    this.type = type
  }

  extract (memory: MemorySnapshot): Option<string> {
    return this.type.extract(memory, this.slot)
  }
}

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

export class MemorySnapshot {
  data: Map<bigint, bigint>

  constructor (raw: Record<string, string>) {
    this.data = new Map()
    const keys = Object.keys(raw)

    for (const key of keys) {
      const keyHex = Buffer.from(key.substring(2, 67), 'hex')
      const valueHex = Buffer.from(raw[key].substring(2, 67), 'hex')
      this.data.set(bytesToBigInt(keyHex), bytesToBigInt(valueHex))
    }
  }

  at(pos: bigint): Option<bigint> {
    return Option.fromNullable(this.data.get(pos))
  }
}


export class MemoryMap {
  pre: MemorySnapshot
  post: MemorySnapshot
  private selectors: Hex[];

  constructor (diff: MemoryDiffRaw, addr: string, selectors: Hex[]) {
    const pre = diff.result.pre[addr]
    const post = diff.result.post[addr]

    if (!pre || !pre.storage) {
      throw new Error("missing pre")
    }

    if (!post || !post.storage) {
      throw new Error("missing post")
    }

    this.pre = new MemorySnapshot(pre.storage)
    this.post = new MemorySnapshot(post.storage)
    this.selectors = selectors
  }

  changeFor (propName: string): Option<PropertyChange> {
    const maybe = Option.fromNullable(this.allProps().find(p => p.name === propName))
    return maybe.map(prop => new PropertyChange(
        prop,
        prop.extract(this.pre),
        prop.extract(this.post)
      )
    )
  }

  allChanges (): PropertyChange[] {
    return this.allProps().map(prop => {
      return new PropertyChange(prop, prop.extract(this.pre), prop.extract(this.post))
    }).filter(change => change.before.isSome() || change.after.isSome())
  }

  private allProps(): Property[] {
    return [
      new Property(
        "Storage.__DEPRECATED_diamondCutStorage",
        0n,
        "[DEPRECATED] Storage of variables needed for deprecated diamond cut facet",
        new FixedArray(7, new AddressType())
      ),
      new Property(
        "Storage.governor",
        7n,
        "Address which will exercise critical changes to the Diamond Proxy (upgrades, freezing & unfreezing)",
        new AddressType()
      ),
      new Property(
        "Storage.verifier",
        10n,
        "Verifier contract. Used to verify aggregated proof for batches",
        new AddressType()
      ),
      new Property(
        "Storage.verifierParams",
        20n,
        "Bytecode hash of default account (bytecode for EOA). Used as an input to zkp-circuit.",
        new VerifierParamsType()
      ),
      new Property(
        "Storage.l2DefaultAccountBytecodeHash",
        24n,
        "Bytecode hash of default account (bytecode for EOA). Used as an input to zkp-circuit.",
        new HexFormat()
      ),
      new Property(
        "Storage.protocolVersion",
        33n,
        "Stores the protocol version. Note, that the protocol version may not only encompass changes to the smart contracts, but also to the node behavior.",
        new BigNumberType()
      ),
      new Property(
        "DiamondStorage.selectorToFacet",
         hexToBigInt("0xc8fcad8db84d3cc18b4c41d551ea0ee66dd599cde068d998e57d5e09332c131b"),
        "A mapping from the selector to the facet address and its meta information",
        new SelectorMappingFormat(this.selectors.map(sel => {
          const as = hexToBytes(sel);
          return Buffer.from(as)
        }))
      )
    ]
  }
}