import type { Hex } from "viem";
import type {
  CurrentZksyncEraState,
  HexEraPropNames,
  NumberEraPropNames,
} from "./current-zksync-era-state";
import { MissingRequiredProp } from "./errors";
import { Option } from "nochoices";

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

  constructor(current: CurrentZksyncEraState, proposed: CurrentZksyncEraState) {
    this.current = current;
    this.proposed = proposed;
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
}
