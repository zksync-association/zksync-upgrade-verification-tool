import {describe, expect, it} from "vitest";
import {NewZkSyncEraDiff} from "../src/lib/new-zk-sync-era-diff";
import {
  type ZkEraStateData,
  CurrentZksyncEraState,
  type NumberEraPropNames,
  type HexEraPropNames
} from "../src/lib/current-zksync-era-state";
import {MissingRequiredProp} from "../src/lib/errors";
import {bytesToHex, type Hex} from "viem";
import type {FacetData} from "../src/lib";
import {Option} from "nochoices";

describe("NewZkSyncStateDiff", () => {
  function diffWithDataChanges(oldData: ZkEraStateData, newData: ZkEraStateData): NewZkSyncEraDiff {
    const current = new CurrentZksyncEraState(oldData, [])
    const changes = new CurrentZksyncEraState(newData, [])

    return new NewZkSyncEraDiff(current, changes)
  }

  describe('hex property diffs', () => {
    const propNames: HexEraPropNames[] = [
      "admin",
      "pendingAdmin",
      "verifierAddress",
      "bridgeHubAddress",
      "blobVersionedHashRetriever",
      "stateTransitionManagerAddress",
      "l2DefaultAccountBytecodeHash",
      "l2BootloaderBytecodeHash",
      "chainId"
    ]

    for (const propName of propNames) {
      describe(propName, () => {
        it("shows changes when both present", () => {
          const oldData = "0xaa"
          const newData = "0xcc"

          const diff = diffWithDataChanges({[propName]: oldData}, {[propName]: newData})
          const [old, proposed] = diff.hexAttrDiff(propName)
          expect(old).toEqual(oldData)
          expect(proposed.unwrap()).toEqual(newData)
        })

        it("returns none in proposal when proposal is absent", () => {
          const oldData = "0xaa"

          const diff = diffWithDataChanges({[propName]: oldData}, {})
          const [_old, proposed] = diff.hexAttrDiff(propName)
          expect(proposed.isNone()).toEqual(true)
        })

        it("throws when current admin is absent", () => {
          const newData = "0xcc"

          const diff = diffWithDataChanges({}, {[propName]: newData})
          expect(() => diff.hexAttrDiff(propName)).toThrow(MissingRequiredProp)
        })
      })
    }
  });

  describe("number property diffs", () => {
    const propertyNames: NumberEraPropNames[] = ["baseTokenGasPriceMultiplierNominator", "baseTokenGasPriceMultiplierDenominator"]
    for (const propertyName of propertyNames) {
      describe(propertyName, () => {
        it(`shows changes when both present`, () => {
          const oldData = 1n
          const newData = 10n

          const diff = diffWithDataChanges({[propertyName]: oldData}, {[propertyName]: newData})
          const [old, proposed] = diff.numberAttrDiff(propertyName)
          expect(old).toEqual(oldData)
          expect(proposed.unwrap()).toEqual(newData)
        })

        it("returns none in proposal when proposal is absent", () => {
          const oldAdmin = 1n

          const diff = diffWithDataChanges({[propertyName]: oldAdmin}, {})
          const [_old, proposed] = diff.numberAttrDiff(propertyName)
          expect(proposed.isNone()).toEqual(true)
        })

        it("throws when current is absent", () => {
          const newData = 10n

          const diff = diffWithDataChanges({}, {[propertyName]: newData})
          expect(() => diff.numberAttrDiff(propertyName)).toThrow(MissingRequiredProp)
        })
      });
    }
  })

  describe("#protocolVersion", () => {
    it("returns simple format for both when both are present and are small numbers", () => {
      const oldVersion = `0x${"0".repeat(63)}a` as Hex
      const newVersion = `0x${"0".repeat(62)}12` as Hex

      const diff = diffWithDataChanges({protocolVersion: oldVersion}, {protocolVersion: newVersion})
      const [old, proposed] = diff.protocolVersion()
      expect(old).toEqual("10")
      expect(proposed).toEqual("18")
    })

    it("mixed formats when one has new format and another has old format", () => {
      const oldVersion = Buffer.alloc(32).fill(0)
      oldVersion[27] = 1
      const newVersion = `0x${"0".repeat(62)}12` as Hex

      const diff = diffWithDataChanges({protocolVersion: bytesToHex(oldVersion)}, {protocolVersion: newVersion})
      const [old, proposed] = diff.protocolVersion()
      expect(old).toEqual("0.1.0")
      expect(proposed).toEqual("18")
    })

    it("if both use semver returns both semver", () => {
      const oldVersion = Buffer.alloc(32).fill(0)
      oldVersion[27] = 1

      const newVersion = Buffer.alloc(32).fill(0)
      newVersion[27] = 1
      newVersion[31] = 1

      const diff = diffWithDataChanges(
        {protocolVersion: bytesToHex(oldVersion)},
        {protocolVersion: bytesToHex(newVersion)}
      )
      const [old, proposed] = diff.protocolVersion()
      expect(old).toEqual("0.1.0")
      expect(proposed).toEqual("0.1.1")
    })

    it("throws error if the current version is missing", () => {
      const newVersion = Buffer.alloc(32).fill(0)
      newVersion[27] = 1
      newVersion[31] = 1

      const diff = diffWithDataChanges(
        {},
        {protocolVersion: bytesToHex(newVersion)}
      )
      expect(() => diff.protocolVersion()).toThrow(MissingRequiredProp)
    })

    it("throws error if the proposed version is missing", () => {
      const oldVersion = Buffer.alloc(32).fill(0)
      oldVersion[27] = 1
      oldVersion[31] = 1

      const diff = diffWithDataChanges(
        {protocolVersion: bytesToHex(oldVersion)},
        {}
      )
      expect(() => diff.protocolVersion()).toThrow(MissingRequiredProp)
    })
  })

  describe("when are changes in the facets", () => {
    function diffWithFacets (currentFacets: FacetData[], proposedFacets: FacetData[]): NewZkSyncEraDiff {
      const current = new CurrentZksyncEraState({}, currentFacets)
      const proposed = new CurrentZksyncEraState({}, proposedFacets)
      return new NewZkSyncEraDiff(current, proposed)
    }

    describe("#addedFacets", () => {
      it("when a facet is added it returns that facet", () => {
        const facet: FacetData = {
          address: "0x01",
          name: "Test",
          selectors: ["0x0a", "0x0b"]
        };
        const diff = diffWithFacets([], [
          facet
        ])

        const added = diff.addedFacets()
        expect(added).toEqual([{
          name: facet.name,
          oldAddress: Option.None(),
          newAddress: Option.Some(facet.address),
          addedSelectors: facet.selectors,
          removedSelectors: [],
          preservedSelectors: []
        }])
      })

      it("when facet already exist from before it's not considered in new facets", () => {
        const oldFacet: FacetData = {
          address: "0x02",
          name: "Old",
          selectors: ["0xaa", "0xab"]
        };
        const newFacet: FacetData = {
          address: "0x01",
          name: "New",
          selectors: ["0x0a", "0x0b"]
        };
        const diff = diffWithFacets([oldFacet], [oldFacet, newFacet])

        const added = diff.addedFacets()
        expect(added).toEqual([{
          name: newFacet.name,
          oldAddress: Option.None(),
          newAddress: Option.Some(newFacet.address),
          addedSelectors: newFacet.selectors,
          removedSelectors: [],
          preservedSelectors: []
        }])
      })

      it("when facets are the same it returns nothing", () => {
        const oldFacet: FacetData = {
          address: "0x02",
          name: "Old",
          selectors: ["0xaa", "0xab"]
        };
        const diff = diffWithFacets([oldFacet], [oldFacet])

        const added = diff.addedFacets()
        expect(added).to.eql([])
      })

      it("when the only difference is a removed facet it returns the same", () => {
        const facet1: FacetData = {
          address: "0x02",
          name: "Facet1",
          selectors: ["0xaa", "0xab"]
        };

        const facet2: FacetData = {
          address: "0x02",
          name: "Facet2",
          selectors: ["0xaa", "0xab"]
        };

        const diff = diffWithFacets([facet1, facet2], [facet1])

        const added = diff.addedFacets()
        expect(added).to.eql([])
      })
    })

    describe("#removedFacets", () => {
      it("returns empty list when no facets are being added or removed", () => {
        const facet1: FacetData = {
          address: "0x02",
          name: "Facet1",
          selectors: ["0xaa", "0xab"]
        };

        const diff = diffWithFacets([facet1], [facet1])

        const removed = diff.removedFacets()
        expect(removed).toEqual([])
      })

      it("returns empty list when a facet is being added", () => {
        const facet1: FacetData = {
          address: "0x02",
          name: "Facet1",
          selectors: ["0xaa", "0xab"]
        };

        const facet2: FacetData = {
          address: "0x02",
          name: "Facet2",
          selectors: ["0xaa", "0xab"]
        };

        const diff = diffWithFacets([facet1], [facet1, facet2])

        const removed = diff.removedFacets()
        expect(removed).toEqual([])
      })

      it("when a facet is totally removed returns that exact facet", () => {
        const facet1: FacetData = {
          address: "0x02",
          name: "Facet1",
          selectors: ["0xaa", "0xab"]
        };

        const facet2: FacetData = {
          address: "0x02",
          name: "Facet2",
          selectors: ["0xaa", "0xab"]
        };

        const diff = diffWithFacets([facet1, facet2], [facet1])

        const removed = diff.removedFacets()
        expect(removed).toEqual([{
          name: facet2.name,
          addedSelectors: [],
          preservedSelectors: [],
          removedSelectors: facet2.selectors,
          oldAddress: Option.Some(facet2.address),
          newAddress: Option.None()
        }])
      })
    })
  })
})
