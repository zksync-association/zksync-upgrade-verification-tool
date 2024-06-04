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
} from "viem";
import {undefined} from "zod";

interface MemoryDataType {
  extract (memory: MemorySnapshot, slot: bigint): Option<string>

  get evmSize (): number
}

export class AddressType implements MemoryDataType {
  extract (memory: MemorySnapshot, slot: bigint): Option<string> {
    return memory.at(slot)
      .map(this.format)
  }

  format (data: Buffer): string {
    const sub = data.subarray(data.length - 20, data.length)
    return bytesToHex(sub);
  }

  get evmSize (): number {
    return 20;
  }
}

class BlobSlot implements MemoryDataType {
  extract (memory: MemorySnapshot, slot: bigint): Option<string> {
    return memory.at(slot)
      .map(this.format)
      .map(str => str.toLowerCase())
  }

  format (data: Buffer): string {
    return bytesToHex(data, { size: 32 })
  }

  get evmSize (): number {
    return 32;
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

    if (values.every(v => v.isNone())) {
      return Option.None()
    }

    return Option.Some(values
      .filter(o => o.isSome())
      .map(o => o.unwrap())
      .join("\n"));
  }

  get evmSize (): number {
    return 32;
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

  get evmSize (): number {
    return this.inner.evmSize * this.size;
  }
}

class VerifierParamsType implements MemoryDataType {
  extract (memory: MemorySnapshot, slot: bigint): Option<string> {
    const hex = new BlobSlot()
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

  get evmSize (): number {
    return 32 * 3;
  }
}

export class BooleanType implements MemoryDataType {
  private offset: number;

  constructor (offset: number) {
    this.offset = offset
  }

  extract (memory: MemorySnapshot, slot: bigint): Option<string> {
    return memory.at(slot)
      .map(buf => buf[buf.length - this.offset - 1])
      .map(byte => byte === 0 ? "false" : "true");
  }

  get evmSize (): number {
    return 1;
  }

}

export class BigNumberType implements MemoryDataType {
  private size: number;
  private offset: number;
  constructor (size = 32, offset = 0) {
    this.size = size
    this.offset = offset
  }

  extract (memory: MemorySnapshot, slot: bigint): Option<string> {
    const start = 32 - this.offset - this.size
    return memory.at(slot)
      .map(buf => buf.subarray(start, start + this.size))
      .map(bytesToBigInt)
      .map(int => int.toString());
  }

  get evmSize (): number {
    return this.size;
  }
}

type StructField = { name: string, type: MemoryDataType }
export class StructType implements MemoryDataType {
  private fields: StructField[];

  constructor (fields: StructField[]) {
    this.fields = fields
  }

  extract (memory: MemorySnapshot, slot: bigint): Option<string> {
    let acum = 0
    // let current = memory.at(slot).unwrapOr(Buffer.alloc(32).fill(0))
    let slotPosition = 0n
    const res: Record<string, Option<string>> = {}
    for (const { name, type} of this.fields) {
      if (acum + type.evmSize > 32) {
        // current = memory.at(slot + slotPosition).unwrapOr(Buffer.alloc(32).fill(0))
        slotPosition += 1n
        acum = 0
      }

      res[name] = type.extract(memory, slot + slotPosition)

      acum += type.evmSize
    }

    if (Object.values(res).every(r => r.isNone())) {
      return Option.None()
    }

    const content = []

    for (const key in res) {
      const value = res[key]
      content.push(`${key}=>${value.unwrapOr("No content.")}`)
    }

    return Option.Some(`{${content.join(',')}}`)
  }

  get evmSize (): number {
    return this.fields.map(field => field.type.evmSize).reduce((a,b) => a + b);
  }
}

export class Property {
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
  data: Map<bigint, Buffer>

  constructor (raw: Record<string, string>) {
    this.data = new Map()
    const keys = Object.keys(raw)

    for (const key of keys) {
      const keyHex = Buffer.from(key.substring(2, 67), 'hex')
      const valueHex = Buffer.from(raw[key].substring(2, 67), 'hex')
      this.data.set(bytesToBigInt(keyHex), valueHex)
    }
  }

  at(pos: bigint): Option<Buffer> {
    return Option.fromNullable(this.data.get(pos))
  }
}


export class MemoryMap {
  pre: MemorySnapshot
  post: MemorySnapshot
  private selectors: Hex[];
  private contractProps: Property[];

  constructor (diff: MemoryDiffRaw, addr: string, selectors: Hex[], contractProps: Property[] = []) {
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
    this.contractProps = contractProps.length === 0
      ? this.allContractProps()
      : contractProps
  }

  changeFor (propName: string): Option<PropertyChange> {
    const maybe = Option.fromNullable(this.contractProps.find(p => p.name === propName))
    return maybe.map(prop => new PropertyChange(
        prop,
        prop.extract(this.pre),
        prop.extract(this.post)
      )
    )
  }

  allChanges (): PropertyChange[] {
    return this.allContractProps().map(prop => {
      return new PropertyChange(prop, prop.extract(this.pre), prop.extract(this.post))
    }).filter(change => change.before.isSome() || change.after.isSome())
  }

  private allContractProps(): Property[] {
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
        new BlobSlot()
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