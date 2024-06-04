import type { MemoryDiffRaw } from "../../schema/rpc";
import { Option } from "nochoices";
import { type Hex, hexToBigInt, hexToBytes } from "viem";
import { AddressType } from "./types/address-type";
import { BlobType } from "./types/blob-type";
import { MappingType } from "./mapping-type";
import { StructType } from "./types/struct-type";
import { BigNumberType } from "./types/big-number-type";
import { Property } from "./property";
import { MemorySnapshot } from "./memory-snapshot";
import { PropertyChange } from "./property-change";
import { BooleanType } from "./types/boolean-type";
import { FixedArrayType } from "./types/fixed-array-type";

export class MemoryMap {
  pre: MemorySnapshot;
  post: MemorySnapshot;
  private selectors: Hex[];
  private contractProps: Property[];

  constructor(diff: MemoryDiffRaw, addr: string, selectors: Hex[], contractProps: Property[] = []) {
    const pre = diff.result.pre[addr];
    const post = diff.result.post[addr];

    if (!pre || !pre.storage) {
      throw new Error("missing pre");
    }

    if (!post || !post.storage) {
      throw new Error("missing post");
    }

    this.pre = new MemorySnapshot(pre.storage);
    this.post = new MemorySnapshot(post.storage);
    this.selectors = selectors;
    this.contractProps = contractProps.length === 0 ? this.allContractProps() : contractProps;
  }

  changeFor(propName: string): Option<PropertyChange> {
    const maybe = Option.fromNullable(this.contractProps.find((p) => p.name === propName));
    return maybe.map(
      (prop) => new PropertyChange(prop, prop.extract(this.pre), prop.extract(this.post))
    );
  }

  allChanges(): PropertyChange[] {
    return this.allContractProps()
      .map((prop) => {
        return new PropertyChange(prop, prop.extract(this.pre), prop.extract(this.post));
      })
      .filter((change) => change.before.isSome() || change.after.isSome());
  }

  private allContractProps(): Property[] {
    return [
      new Property(
        "Storage.__DEPRECATED_diamondCutStorage",
        0n,
        "[DEPRECATED] Storage of variables needed for deprecated diamond cut facet",
        new FixedArrayType(7, new AddressType())
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
        new StructType([
          {
            name: "recursionNodeLevelVkHash",
            type: new BlobType()
          },
          {
            name: "recursionLeafLevelVkHash",
            type: new BlobType()
          },
          {
            name: "recursionCircuitsSetVksHash",
            type: new BlobType()
          }
        ])
      ),
      new Property(
        "Storage.l2DefaultAccountBytecodeHash",
        24n,
        "Bytecode hash of default account (bytecode for EOA). Used as an input to zkp-circuit.",
        new BlobType()
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
        new MappingType(
          this.selectors.map((sel) => {
            const as = hexToBytes(sel);
            return Buffer.from(as);
          }),
          new StructType([
            {
              name: "facetAddress",
              type: new AddressType(),
            },
            {
              name: "selectorPosition",
              type: new BigNumberType(2, 20),
            },
            {
              name: "isFreezable",
              type: new BooleanType(22),
            },
          ])
        )
      ),
    ];
  }
}
