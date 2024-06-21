import {describe, expect, it} from "vitest";
import {NewZkSyncEraDiff} from "../src/lib/new-zk-sync-era-diff";
import {
  type ZkEraStateData,
  CurrentZksyncEraState,
  type NumberEraPropNames,
  type HexEraPropNames
} from "../src/lib/current-zksync-era-state";
import {MissingRequiredProp} from "../src/lib/errors";

describe("NewZkSyncStateDiff", () => {
  function setUp(oldData: ZkEraStateData, newData: ZkEraStateData): NewZkSyncEraDiff {
    const current = new CurrentZksyncEraState(oldData)
    const changes = new CurrentZksyncEraState(newData)

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
      "l2BootloaderBytecodeHash"
    ]

    for (const propName of propNames) {
      describe(propName, () => {
        it("shows changes when both present", () => {
          const oldData = "0xaa"
          const newData = "0xcc"

          const diff = setUp({[propName]: oldData}, {[propName]: newData})
          const [old, proposed] = diff.hexAttrDiff(propName)
          expect(old).toEqual(oldData)
          expect(proposed.unwrap()).toEqual(newData)
        })

        it("returns none in proposal when proposal is absent", () => {
          const oldData = "0xaa"

          const diff = setUp({[propName]: oldData}, {})
          const [_old, proposed] = diff.hexAttrDiff(propName)
          expect(proposed.isNone()).toEqual(true)
        })

        it("throws when current admin is absent", () => {
          const newData = "0xcc"

          const diff = setUp({}, {[propName]: newData})
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

          const diff = setUp({[propertyName]: oldData}, {[propertyName]: newData})
          const [old, proposed] = diff.numberAttrDiff(propertyName)
          expect(old).toEqual(oldData)
          expect(proposed.unwrap()).toEqual(newData)
        })

        it("returns none in proposal when proposal is absent", () => {
          const oldAdmin = 1n

          const diff = setUp({[propertyName]: oldAdmin}, {})
          const [_old, proposed] = diff.numberAttrDiff(propertyName)
          expect(proposed.isNone()).toEqual(true)
        })

        it("throws when current is absent", () => {
          const newData = 10n

          const diff = setUp({}, {[propertyName]: newData})
          expect(() => diff.numberAttrDiff(propertyName)).toThrow(MissingRequiredProp)
        })
      });
    }
  })
})
