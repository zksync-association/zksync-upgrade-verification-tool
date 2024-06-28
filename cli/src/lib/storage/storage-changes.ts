import type { MemoryDiffRaw } from "../../schema/rpc";
import { Option } from "nochoices";
import { type Hex, hexToBigInt } from "viem";
import type { ContractField } from "./contractField";
import type { StorageSnapshot } from "./storage-snapshot";
import { PropertyChange } from "./property-change";
import { RecordStorageSnapshot } from "./record-storage-snapshot";
import { mainDiamondFields } from "./storage-props";

export const DIAMOND_STORAGE_SLOT = hexToBigInt(
  "0xc8fcad8db84d3cc18b4c41d551ea0ee66dd599cde068d998e57d5e09332c131b"
);

export class StorageChanges {
  pre: StorageSnapshot;
  post: StorageSnapshot;
  private selectors: Hex[];
  private contractProps: ContractField[];
  private facets: Hex[];

  constructor(
    diff: MemoryDiffRaw,
    addr: string,
    selectors: Hex[],
    facets: Hex[] = [],
    contractProps: ContractField[] = []
  ) {
    const pre = diff.result.pre[addr];
    const post = diff.result.post[addr];

    if (!pre) {
      throw new Error("missing pre");
    }

    if (!post) {
      throw new Error("missing post");
    }

    const preStorage = pre.storage.unwrapOr({});
    const postStorage = post.storage.unwrapOr({});

    this.pre = new RecordStorageSnapshot(preStorage);
    this.post = new RecordStorageSnapshot(postStorage);
    this.selectors = selectors;
    this.facets = facets;
    this.contractProps = contractProps.length === 0 ? this.allContractProps() : contractProps;
  }

  async changeFor(propName: string): Promise<Option<PropertyChange>> {
    const found = this.contractProps.find((p) => p.name === propName);
    if (!found) {
      return Option.None();
    }
    return Option.Some(
      new PropertyChange(found, await found.extract(this.pre), await found.extract(this.post))
    );
  }

  async allChanges(): Promise<PropertyChange[]> {
    const all = await Promise.all(
      this.contractProps.map(async (prop) => {
        return new PropertyChange(
          prop,
          await prop.extract(this.pre),
          await prop.extract(this.post)
        );
      })
    );
    return all.filter((change) => change.before.isSome() || change.after.isSome());
  }

  private allContractProps(): ContractField[] {
    return mainDiamondFields(this.selectors, this.facets);
  }
}
