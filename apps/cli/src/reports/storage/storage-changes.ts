import { Option } from "nochoices";
import type { Hex } from "viem";
import type { ContractField } from "./contractField.js";
import type { StorageSnapshot } from "./snapshot";
import { PropertyChange } from "./property-change.js";
import { mainDiamondFields } from "./storage-props.js";
import { EqualityVisitor } from "../reports/equality-visitor";

export class StorageChanges {
  pre: StorageSnapshot;
  post: StorageSnapshot;
  private selectors: Hex[];
  private contractProps: ContractField[];
  private facets: Hex[];

  constructor(
    pre: StorageSnapshot,
    post: StorageSnapshot,
    selectors: Hex[],
    facets: Hex[] = [],
    contractProps: ContractField[] = []
  ) {
    this.pre = pre;
    this.post = post;
    this.selectors = selectors;
    this.facets = facets;
    this.contractProps = contractProps.length === 0 ? this.allContractProps() : contractProps;
  }

  async changeFor(propName: string): Promise<Option<PropertyChange>> {
    const found = this.contractProps.find((p) => p.name === propName);
    if (!found) {
      return Option.None();
    }

    return this.extractChange(found)
  }

  private async extractChange(found: ContractField): Promise<Option<PropertyChange>> {
    const pre = await found.extract(this.pre);
    const after = await found.extract(this.post);

    const zipped = pre.zip(after)
      .filter(([p, a]) => {
        const equalVisitor = new EqualityVisitor(a)
        return !p.accept(equalVisitor)
      });

    return pre.xor(after).map((_) => new PropertyChange(found, pre, after))
      .or(zipped.map((_) => new PropertyChange(found, pre, after)))
  }

  async allChanges(): Promise<PropertyChange[]> {
    const all = await Promise.all(
      this.contractProps.map(async (prop) => {
        return this.extractChange(prop).then(opt => opt.toArray());
      })
    );
    return all.flat().filter((change) => change.before.isSome() || change.after.isSome());
  }

  private allContractProps(): ContractField[] {
    return mainDiamondFields(this.selectors, this.facets);
  }
}
