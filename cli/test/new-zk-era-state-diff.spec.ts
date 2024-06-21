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
      "l2BootloaderBytecodeHash",
      "chainId"
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

  describe("#protocolVersion", () => {
    it("returns simple format for both when both are present and are small numbers", () => {
      const oldVersion = `0x${"0".repeat(63)}a` as Hex
      const newVersion = `0x${"0".repeat(62)}12` as Hex

      const diff = setUp({protocolVersion: oldVersion}, {protocolVersion: newVersion})
      const [old, proposed] = diff.protocolVersion()
      expect(old).toEqual("10")
      expect(proposed).toEqual("18")
    })

    it("mixed formats when one has new format and another has old format", () => {
      const oldVersion = Buffer.alloc(32).fill(0)
      oldVersion[27] = 1
      const newVersion = `0x${"0".repeat(62)}12` as Hex

      const diff = setUp({protocolVersion: bytesToHex(oldVersion)}, {protocolVersion: newVersion})
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

      const diff = setUp(
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

      const diff = setUp(
        {},
        {protocolVersion: bytesToHex(newVersion)}
      )
      expect(() => diff.protocolVersion()).toThrow(MissingRequiredProp)
    })

    it("throws error if the proposed version is missing", () => {
      const oldVersion = Buffer.alloc(32).fill(0)
      oldVersion[27] = 1
      oldVersion[31] = 1

      const diff = setUp(
        {protocolVersion: bytesToHex(oldVersion)},
        {}
      )
      expect(() => diff.protocolVersion()).toThrow(MissingRequiredProp)
    })
  })
})
