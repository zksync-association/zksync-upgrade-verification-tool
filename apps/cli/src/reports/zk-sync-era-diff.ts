import type { Hex } from "viem";
import type { ZksyncEraState, HexEraPropName, NumberEraPropNames } from "./zksync-era-state.js";
import { Option } from "nochoices";
import type { FacetData } from "./upgrade-changes.js";
import { SystemContractChange } from "./system-contract-change.js";
import { MissingRequiredProp } from "../lib/errors";

export type FacetDataDiff = {
  name: string;
  oldAddress: Option<string>;
  newAddress: Option<string>;
  addedSelectors: Hex[];
  removedSelectors: Hex[];
  preservedSelectors: Hex[];
};

export function hexAreEq(hex1: Hex, hex2: Hex): boolean {
  return hex1.toLowerCase() === hex2.toLowerCase();
}

export class ZkSyncEraDiff {
  current: ZksyncEraState;
  proposed: ZksyncEraState;
  private affectedSystemContracts: Hex[];

  constructor(current: ZksyncEraState, proposed: ZksyncEraState) {
    this.current = current;
    this.proposed = proposed;
    this.affectedSystemContracts = this.proposed.affectedSystemContracts.map(sc => sc.address);
  }

  hexAttrDiff(prop: HexEraPropName): [Hex, Option<Hex>] {
    const current = this.current.hexAttrValue(prop).expect(new MissingRequiredProp(prop));
    return [
      current,
      this.proposed.hexAttrValue(prop).filter((proposed) => !hexAreEq(current, proposed)),
    ];
  }

  numberAttrDiff(prop: NumberEraPropNames): [bigint, Option<bigint>] {
    const current = this.current.numberAttrValue(prop).expect(new MissingRequiredProp(prop));
    return [
      current,
      this.proposed.numberAttrValue(prop).filter((proposed) => proposed !== current),
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
    upgradedFacets = upgradedFacets.filter(([o, n]) => !hexAreEq(o.address, n.address));

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
          current
            .or(proposed)
            .map((c) => c.name)
            .unwrap(),
          current.map((c) => c.bytecodeHash),
          proposed.unwrap().bytecodeHash
        );
      })
    );

    return changes.filter(
      (c) => !c.currentBytecodeHash.isSomeAnd((current) => current === c.proposedBytecodeHash)
    );
  }
}
