import type { Hex } from "viem";
import type {
  CurrentZksyncEraState,
  HexEraPropNames,
  NumberEraPropNames,
} from "./current-zksync-era-state";
import { MissingRequiredProp } from "./errors";
import { Option } from "nochoices";
import type { FacetData } from "./upgrade-changes";
import { SystemContractChange } from "./system-contract-change";

export type FacetDataDiff = {
  name: string;
  oldAddress: Option<string>;
  newAddress: Option<string>;
  addedSelectors: Hex[];
  removedSelectors: Hex[];
  preservedSelectors: Hex[];
};

export class NewZkSyncEraDiff {
  current: CurrentZksyncEraState;
  proposed: CurrentZksyncEraState;
  private affectedSystemContracts: Hex[];

  constructor(
    current: CurrentZksyncEraState,
    proposed: CurrentZksyncEraState,
    sysContractsAddrs: Hex[]
  ) {
    this.current = current;
    this.proposed = proposed;
    this.affectedSystemContracts = sysContractsAddrs;
  }

  hexAttrDiff(prop: HexEraPropNames): [Hex, Option<Hex>] {
    return [
      this.current.hexAttrValue(prop).expect(new MissingRequiredProp(prop)),
      this.proposed.hexAttrValue(prop),
    ];
  }

  numberAttrDiff(prop: NumberEraPropNames): [bigint, Option<bigint>] {
    return [
      this.current.numberAttrValue(prop).expect(new MissingRequiredProp(prop)),
      this.proposed.numberAttrValue(prop),
    ];
  }

  protocolVersion(): [string, string] {
    return [this.current.protocolVersion(), this.proposed.protocolVersion()];
  }

  addedFacets(): FacetDataDiff[] {
    const oldFacets = this.current.allFacets();
    const newFacets = this.proposed.allFacets();
    const addedFacets = newFacets.filter((newFacet) => {
      return oldFacets.every((oldFacet) => oldFacet.name !== newFacet.name);
    });

    return addedFacets.map((facet) => ({
      name: facet.name,
      addedSelectors: facet.selectors,
      newAddress: Option.Some(facet.address),
      oldAddress: Option.None(),
      removedSelectors: [],
      preservedSelectors: [],
    }));
  }

  removedFacets(): FacetDataDiff[] {
    const oldFacets = this.current.allFacets();
    const newFacets = this.proposed.allFacets();
    const removedFacets = oldFacets.filter((newFacet) => {
      return newFacets.every((oldFacet) => oldFacet.name !== newFacet.name);
    });

    return removedFacets.map((facet) => ({
      name: facet.name,
      addedSelectors: [],
      preservedSelectors: [],
      removedSelectors: facet.selectors,
      oldAddress: Option.Some(facet.address),
      newAddress: Option.None(),
    }));
  }

  upgradedFacets(): FacetDataDiff[] {
    const oldFacets = this.current.allFacets();
    const newFacets = this.proposed.allFacets();
    let upgradedFacets = newFacets
      .map((newFacet) => {
        return [newFacet, oldFacets.find((oldFacet) => oldFacet.name === newFacet.name)] as const;
      })
      .filter(([_newFacet, oldFacetOrNull]) => oldFacetOrNull) as [FacetData, FacetData][];
    upgradedFacets = upgradedFacets.filter(([o, n]) => o.address !== n.address);

    return upgradedFacets.map(([newFacet, oldFacet]) => {
      const addedSelectors = newFacet.selectors.filter((sel) => !oldFacet.selectors.includes(sel));
      const removedSelectors = oldFacet.selectors.filter(
        (sel) => !newFacet.selectors.includes(sel)
      );
      return {
        name: oldFacet.name,
        oldAddress: Option.Some(oldFacet.address),
        newAddress: Option.Some(newFacet.address),
        addedSelectors,
        removedSelectors,
        preservedSelectors: oldFacet.selectors,
      };
    });
  }

  async systemContractChanges(): Promise<SystemContractChange[]> {
    const changes = await Promise.all(
      this.affectedSystemContracts.map(async (addr) => {
        const current = await this.current.dataForL2Address(addr);
        const proposed = await this.proposed.dataForL2Address(addr);

        return new SystemContractChange(
          addr,
          current.map(c => c.name).unwrapOr("Unknown name."),
          current.map(c => c.bytecodeHash).map(v => v.toString()).unwrapOr("Not found."),
          proposed.unwrap().bytecodeHash
        );
      })
    );
    return changes.filter((c) => c.currentBytecodeHash !== c.proposedBytecodeHash);
  }
}
