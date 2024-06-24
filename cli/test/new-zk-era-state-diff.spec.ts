import { describe, expect, it } from "vitest";
import { NewZkSyncEraDiff } from "../src/lib/new-zk-sync-era-diff";
import {
  type ZkEraStateData,
  CurrentZksyncEraState,
  type NumberEraPropNames,
  type HexEraPropNames,
  type L2ContractData,
} from "../src/lib/current-zksync-era-state";
import { MissingRequiredProp } from "../src/lib/errors";
import { bytesToHex, type Hex } from "viem";
import {BlockExplorerClient, type FacetData} from "../src/lib";
import { Option } from "nochoices";
import fs from "node:fs/promises";
import path from "node:path";
import { SystemContractList } from "../src/lib/system-contract-providers";
import {RpcClient} from "../src/lib/rpc-client";

describe("NewZkSyncStateDiff", () => {
  function diffWithDataChanges(oldData: ZkEraStateData, newData: ZkEraStateData): NewZkSyncEraDiff {
    const current = new CurrentZksyncEraState(oldData, [], new SystemContractList([]));
    const changes = new CurrentZksyncEraState(newData, [], new SystemContractList([]));

    return new NewZkSyncEraDiff(current, changes, []);
  }

  describe("hex property diffs", () => {
    const propNames: HexEraPropNames[] = [
      "admin",
      "pendingAdmin",
      "verifierAddress",
      "bridgeHubAddress",
      "blobVersionedHashRetriever",
      "stateTransitionManagerAddress",
      "l2DefaultAccountBytecodeHash",
      "l2BootloaderBytecodeHash",
    ];

    for (const propName of propNames) {
      describe(propName, () => {
        it("shows changes when both present", () => {
          const oldData = "0xaa";
          const newData = "0xcc";

          const diff = diffWithDataChanges({ [propName]: oldData }, { [propName]: newData });
          const [old, proposed] = diff.hexAttrDiff(propName);
          expect(old).toEqual(oldData);
          expect(proposed.unwrap()).toEqual(newData);
        });

        it("returns none in proposal when proposal is absent", () => {
          const oldData = "0xaa";

          const diff = diffWithDataChanges({ [propName]: oldData }, {});
          const [_old, proposed] = diff.hexAttrDiff(propName);
          expect(proposed.isNone()).toEqual(true);
        });

        it("throws when current admin is absent", () => {
          const newData = "0xcc";

          const diff = diffWithDataChanges({}, { [propName]: newData });
          expect(() => diff.hexAttrDiff(propName)).toThrow(MissingRequiredProp);
        });
      });
    }
  });

  describe("number property diffs", () => {
    const propertyNames: NumberEraPropNames[] = [
      "baseTokenGasPriceMultiplierNominator",
      "baseTokenGasPriceMultiplierDenominator",
      "chainId",
    ];
    for (const propertyName of propertyNames) {
      describe(propertyName, () => {
        it(`shows changes when both present`, () => {
          const oldData = 1n;
          const newData = 10n;

          const diff = diffWithDataChanges(
            { [propertyName]: oldData },
            { [propertyName]: newData }
          );
          const [old, proposed] = diff.numberAttrDiff(propertyName);
          expect(old).toEqual(oldData);
          expect(proposed.unwrap()).toEqual(newData);
        });

        it("returns none in proposal when proposal is absent", () => {
          const oldAdmin = 1n;

          const diff = diffWithDataChanges({ [propertyName]: oldAdmin }, {});
          const [_old, proposed] = diff.numberAttrDiff(propertyName);
          expect(proposed.isNone()).toEqual(true);
        });

        it("throws when current is absent", () => {
          const newData = 10n;

          const diff = diffWithDataChanges({}, { [propertyName]: newData });
          expect(() => diff.numberAttrDiff(propertyName)).toThrow(MissingRequiredProp);
        });
      });
    }
  });

  describe("#protocolVersion", () => {
    it("returns simple format for both when both are present and are small numbers", () => {
      const oldVersion = `0x${"0".repeat(63)}a` as Hex;
      const newVersion = `0x${"0".repeat(62)}12` as Hex;

      const diff = diffWithDataChanges(
        { protocolVersion: oldVersion },
        { protocolVersion: newVersion }
      );
      const [old, proposed] = diff.protocolVersion();
      expect(old).toEqual("10");
      expect(proposed).toEqual("18");
    });

    it("mixed formats when one has new format and another has old format", () => {
      const oldVersion = Buffer.alloc(32).fill(0);
      oldVersion[27] = 1;
      const newVersion = `0x${"0".repeat(62)}12` as Hex;

      const diff = diffWithDataChanges(
        { protocolVersion: bytesToHex(oldVersion) },
        { protocolVersion: newVersion }
      );
      const [old, proposed] = diff.protocolVersion();
      expect(old).toEqual("0.1.0");
      expect(proposed).toEqual("18");
    });

    it("if both use semver returns both semver", () => {
      const oldVersion = Buffer.alloc(32).fill(0);
      oldVersion[27] = 1;

      const newVersion = Buffer.alloc(32).fill(0);
      newVersion[27] = 1;
      newVersion[31] = 1;

      const diff = diffWithDataChanges(
        { protocolVersion: bytesToHex(oldVersion) },
        { protocolVersion: bytesToHex(newVersion) }
      );
      const [old, proposed] = diff.protocolVersion();
      expect(old).toEqual("0.1.0");
      expect(proposed).toEqual("0.1.1");
    });

    it("throws error if the current version is missing", () => {
      const newVersion = Buffer.alloc(32).fill(0);
      newVersion[27] = 1;
      newVersion[31] = 1;

      const diff = diffWithDataChanges({}, { protocolVersion: bytesToHex(newVersion) });
      expect(() => diff.protocolVersion()).toThrow(MissingRequiredProp);
    });

    it("throws error if the proposed version is missing", () => {
      const oldVersion = Buffer.alloc(32).fill(0);
      oldVersion[27] = 1;
      oldVersion[31] = 1;

      const diff = diffWithDataChanges({ protocolVersion: bytesToHex(oldVersion) }, {});
      expect(() => diff.protocolVersion()).toThrow(MissingRequiredProp);
    });
  });

  describe("when are changes in the facets", () => {
    function diffWithFacets(
      currentFacets: FacetData[],
      proposedFacets: FacetData[]
    ): NewZkSyncEraDiff {
      const current = new CurrentZksyncEraState({}, currentFacets, new SystemContractList([]));
      const proposed = new CurrentZksyncEraState({}, proposedFacets, new SystemContractList([]));
      return new NewZkSyncEraDiff(current, proposed, []);
    }

    describe("#addedFacets", () => {
      it("when a facet is added it returns that facet", () => {
        const facet: FacetData = {
          address: "0x01",
          name: "Test",
          selectors: ["0x0a", "0x0b"],
        };
        const diff = diffWithFacets([], [facet]);

        const added = diff.addedFacets();
        expect(added).toEqual([
          {
            name: facet.name,
            oldAddress: Option.None(),
            newAddress: Option.Some(facet.address),
            addedSelectors: facet.selectors,
            removedSelectors: [],
            preservedSelectors: [],
          },
        ]);
      });

      it("when facet already exist from before it's not considered in new facets", () => {
        const oldFacet: FacetData = {
          address: "0x02",
          name: "Old",
          selectors: ["0xaa", "0xab"],
        };
        const newFacet: FacetData = {
          address: "0x01",
          name: "New",
          selectors: ["0x0a", "0x0b"],
        };
        const diff = diffWithFacets([oldFacet], [oldFacet, newFacet]);

        const added = diff.addedFacets();
        expect(added).toEqual([
          {
            name: newFacet.name,
            oldAddress: Option.None(),
            newAddress: Option.Some(newFacet.address),
            addedSelectors: newFacet.selectors,
            removedSelectors: [],
            preservedSelectors: [],
          },
        ]);
      });

      it("when facets are the same it returns nothing", () => {
        const oldFacet: FacetData = {
          address: "0x02",
          name: "Old",
          selectors: ["0xaa", "0xab"],
        };
        const diff = diffWithFacets([oldFacet], [oldFacet]);

        const added = diff.addedFacets();
        expect(added).to.eql([]);
      });

      it("when the only difference is a removed facet it returns the same", () => {
        const facet1: FacetData = {
          address: "0x02",
          name: "Facet1",
          selectors: ["0xaa", "0xab"],
        };

        const facet2: FacetData = {
          address: "0x02",
          name: "Facet2",
          selectors: ["0xaa", "0xab"],
        };

        const diff = diffWithFacets([facet1, facet2], [facet1]);

        const added = diff.addedFacets();
        expect(added).to.eql([]);
      });
    });

    describe("#removedFacets", () => {
      it("returns empty list when no facets are being added or removed", () => {
        const facet1: FacetData = {
          address: "0x02",
          name: "Facet1",
          selectors: ["0xaa", "0xab"],
        };

        const diff = diffWithFacets([facet1], [facet1]);

        const removed = diff.removedFacets();
        expect(removed).toEqual([]);
      });

      it("returns empty list when a facet is being added", () => {
        const facet1: FacetData = {
          address: "0x02",
          name: "Facet1",
          selectors: ["0xaa", "0xab"],
        };

        const facet2: FacetData = {
          address: "0x02",
          name: "Facet2",
          selectors: ["0xaa", "0xab"],
        };

        const diff = diffWithFacets([facet1], [facet1, facet2]);

        const removed = diff.removedFacets();
        expect(removed).toEqual([]);
      });

      it("when a facet is totally removed returns that exact facet", () => {
        const facet1: FacetData = {
          address: "0x02",
          name: "Facet1",
          selectors: ["0xaa", "0xab"],
        };

        const facet2: FacetData = {
          address: "0x02",
          name: "Facet2",
          selectors: ["0xaa", "0xab"],
        };

        const diff = diffWithFacets([facet1, facet2], [facet1]);

        const removed = diff.removedFacets();
        expect(removed).toEqual([
          {
            name: facet2.name,
            addedSelectors: [],
            preservedSelectors: [],
            removedSelectors: facet2.selectors,
            oldAddress: Option.Some(facet2.address),
            newAddress: Option.None(),
          },
        ]);
      });
    });

    describe("#upgradedFacets", () => {
      it("does not return facets that did not change", () => {
        const facet: FacetData = {
          address: "0x02",
          name: "Facet",
          selectors: ["0xaa", "0xab"],
        };

        const diff = diffWithFacets([facet], [facet]);

        const removed = diff.upgradedFacets();
        expect(removed).toEqual([]);
      });

      it("returns a facet that has same selectors but new address", () => {
        const facet1: FacetData = {
          address: "0x02",
          name: "Facet",
          selectors: ["0xaa", "0xab"],
        };

        const facet2: FacetData = {
          address: "0x03",
          name: "Facet",
          selectors: ["0xaa", "0xab"],
        };

        const diff = diffWithFacets([facet1], [facet2]);

        const removed = diff.upgradedFacets();
        expect(removed).toEqual([
          {
            name: facet1.name,
            addedSelectors: [],
            preservedSelectors: facet1.selectors,
            removedSelectors: [],
            oldAddress: Option.Some(facet1.address),
            newAddress: Option.Some(facet2.address),
          },
        ]);
      });

      it("when the facet is moved to a new one and selectors are added those are returned", () => {
        const facet1: FacetData = {
          address: "0x02",
          name: "Facet",
          selectors: ["0xaa", "0xab"],
        };

        const facet2: FacetData = {
          address: "0x03",
          name: "Facet",
          selectors: ["0xaa", "0xab", "0xac"],
        };

        const diff = diffWithFacets([facet1], [facet2]);

        const removed = diff.upgradedFacets();
        expect(removed).toEqual([
          {
            name: facet1.name,
            addedSelectors: ["0xac"],
            preservedSelectors: facet1.selectors,
            removedSelectors: [],
            oldAddress: Option.Some(facet1.address),
            newAddress: Option.Some(facet2.address),
          },
        ]);
      });

      it("shows which selectors were removed", () => {
        const facet1: FacetData = {
          address: "0x02",
          name: "Facet",
          selectors: ["0xaa", "0xab"],
        };

        const facet2: FacetData = {
          address: "0x03",
          name: "Facet",
          selectors: ["0xaa"],
        };

        const diff = diffWithFacets([facet1], [facet2]);

        const removed = diff.upgradedFacets();
        expect(removed).toEqual([
          {
            name: facet1.name,
            addedSelectors: [],
            preservedSelectors: facet1.selectors,
            removedSelectors: ["0xab"],
            oldAddress: Option.Some(facet1.address),
            newAddress: Option.Some(facet2.address),
          },
        ]);
      });
    });

    it("summarizes changes", () => {
      const repeatedFacet: FacetData = {
        address: "0x02",
        name: "RepeatedFacet",
        selectors: ["0x01", "0x02"],
      };

      const upgradedFacetPre: FacetData = {
        address: "0x03",
        name: "UpgradedFacet",
        selectors: ["0xaa", "0xab", "0xac", "0xad"],
      };

      const upgradedFacetPost: FacetData = {
        address: "0x04",
        name: "UpgradedFacet",
        selectors: ["0xaa", "0xab", "0xb1", "0xb2"],
      };

      const removedFacet: FacetData = {
        address: "0x05",
        name: "RemovedFacet",
        selectors: ["0x03", "0x04"],
      };

      const createdFacet: FacetData = {
        address: "0x06",
        name: "CreatedFacets",
        selectors: ["0x05", "0x06"],
      };

      const diff = diffWithFacets(
        [repeatedFacet, upgradedFacetPre, removedFacet],
        [repeatedFacet, upgradedFacetPost, createdFacet]
      );

      const added = diff.addedFacets();
      const removed = diff.removedFacets();
      const upgraded = diff.upgradedFacets();
      expect(added.length).to.eql(1);
      expect(removed.length).to.eql(1);
      expect(upgraded.length).to.eql(1);
    });
  });

  describe("when changes are made in the l2 contracts", () => {
    function diffWithSystemContracts(
      sysContractsAddrs: Hex[],
      currentList: L2ContractData[],
      proposedList: L2ContractData[]
    ) {
      const current = new CurrentZksyncEraState({}, [], new SystemContractList(currentList));
      const proposed = new CurrentZksyncEraState({}, [], new SystemContractList(proposedList));
      return new NewZkSyncEraDiff(current, proposed, sysContractsAddrs);
    }

    it("returns changes for affected system contracts", async () => {
      const currentSystemContracts: L2ContractData[] = [
        {
          address: "0x01",
          name: "SystemContract01",
          bytecodeHash: "0x000a",
        },
      ];

      const proposedSystemContracts: L2ContractData[] = [
        {
          address: "0x01",
          name: "SystemContract01",
          bytecodeHash: "0x000b",
        },
      ];

      const diff = diffWithSystemContracts(
        ["0x01"],
        currentSystemContracts,
        proposedSystemContracts
      );

      const changes = await diff.systemContractChanges();
      expect(changes.length).to.eql(1);
      expect(changes[0].address).to.eql("0x01");
      expect(changes[0].name).to.eql("SystemContract01");
      expect(changes[0].currentBytecodeHash).to.eql("0x000a");
      expect(changes[0].proposedBytecodeHash).to.eql("0x000b");
    });

    it("when hashes for old and new are the same is not returned", async () => {
      const currentSystemContracts: L2ContractData[] = [
        {
          address: "0x01",
          name: "SystemContract01",
          bytecodeHash: "0x000a",
        },
      ];

      const proposedSystemContracts: L2ContractData[] = [
        {
          address: "0x01",
          name: "SystemContract01",
          bytecodeHash: "0x000a",
        },
      ];

      const diff = diffWithSystemContracts(
        ["0x01"],
        currentSystemContracts,
        proposedSystemContracts
      );

      const changes = await diff.systemContractChanges();
      expect(changes.length).to.eql(0);
    });
  });

  describe("#createFromCallData", () => {
    it("works", async () => {
      const hexBuff = await fs.readFile(
        path.join(import.meta.dirname, "data", "upgrade-calldata.hex")
      );
      const buff = Buffer.from(hexBuff.toString(), "hex");

      const explorer = BlockExplorerClient.forL1("IA817WPSNENBAK9EE3SNM1C5C31YUTZ4MV", "mainnet")
      const rpc = RpcClient.forL1("mainnet")

      const state = await CurrentZksyncEraState.fromCalldata(buff, "mainnet", explorer, rpc)
      const facets = state.allFacets()
      const admin = facets.find(f => f.name === "AdminFacet")
      if (!admin) {
        return expect.fail("admin should be present")
      }
      expect(admin.address).toEqual("0xF6F26b416CE7AE5e5FE224Be332C7aE4e1f3450a")

      const getters = facets.find(f => f.name === "GettersFacet")
      if (!getters) {
        return expect.fail("getters should be present")
      }
      expect(getters.address).toEqual("0xE60E94fCCb18a81D501a38959E532C0A85A1be89")

      const mailbox = facets.find(f => f.name === "MailboxFacet")
      if (!mailbox) {
        return expect.fail("mailbox should be present")
      }
      expect(mailbox.address).toEqual("0xCDB6228b616EEf8Df47D69A372C4f725C43e718C")

      const executor = facets.find(f => f.name === "ExecutorFacet")
      if (!executor) {
        return expect.fail("executor should be present")
      }
      expect(executor.address).toEqual("0xaD193aDe635576d8e9f7ada71Af2137b16c64075")

      expect(state.numberAttrValue("chainId").unwrap()).toEqual(324n)
      expect(state.hexAttrValue("bridgeHubAddress").unwrap().toLowerCase())
        .toEqual("0x303a465B659cBB0ab36eE643eA362c509EEb5213".toLowerCase())
      expect(state.hexAttrValue("stateTransitionManagerAddress").unwrap().toLowerCase())
        .toEqual("0xc2eE6b6af7d616f6e27ce7F4A451Aedc2b0F5f5C".toLowerCase())
      expect(state.hexAttrValue("baseTokenBridgeAddress").unwrap().toLowerCase())
        .toEqual("0xD7f9f54194C633F36CCD5F3da84ad4a1c38cB2cB".toLowerCase())
      expect(state.hexAttrValue("admin").unwrap().toLowerCase())
        .toEqual("0x0b622A2061EaccAE1c664eBC3E868b8438e03F61".toLowerCase())
    })
  })

  describe("#createFromBlockchain", async () => {
    it("can be created from calldata", async (t) => {
      const key = process.env.ETHERSCAN_API_KEY
      if(!key) {
        return t.skip()
      }

      const explorer = BlockExplorerClient.forL1(key, "mainnet")
      const rpc = RpcClient.forL1("mainnet")
      const state = await CurrentZksyncEraState.fromBlockchain("mainnet", explorer, rpc);
      expect(state.allFacets()).toHaveLength(4);

      expect(state.hexAttrValue("admin").unwrap()).toMatch(/0x.*/);
      expect(state.hexAttrValue("pendingAdmin").unwrap()).toMatch(/0x.*/);
      expect(state.hexAttrValue("verifierAddress").unwrap()).toMatch(/0x.*/);
      expect(state.hexAttrValue("bridgeHubAddress").unwrap()).toMatch(/0x.*/);
      expect(state.hexAttrValue("stateTransitionManagerAddress").unwrap()).toMatch(/0x.*/);
      expect(state.hexAttrValue("l2DefaultAccountBytecodeHash").unwrap()).toMatch(/0x.*/);
      expect(state.hexAttrValue("l2BootloaderBytecodeHash").unwrap()).toMatch(/0x.*/);
      expect(state.hexAttrValue("blobVersionedHashRetriever").unwrap()).toMatch(/0x.*/);
      expect(state.numberAttrValue("chainId").unwrap()).not.toBe(0);
      expect(state.numberAttrValue("baseTokenGasPriceMultiplierNominator").unwrap()).not.toBe(0);
      expect(state.numberAttrValue("baseTokenGasPriceMultiplierDenominator").unwrap()).not.toBe(0);

      const l2Contracts = [
        {
          addr: "0x0000000000000000000000000000000000000000",
          name: /EmptyContract/,
        },
        {
          addr: "0x0000000000000000000000000000000000000001",
          name: /Ecrecover/,
        },
        {
          addr: "0x0000000000000000000000000000000000000002",
          name: /SHA256/,
        },
        {
          addr: "0x0000000000000000000000000000000000000006",
          name: /EcAdd/,
        },
        {
          addr: "0x0000000000000000000000000000000000000007",
          name: /EcMul/,
        },
        {
          addr: "0x0000000000000000000000000000000000000008",
          name: /EcPairing/,
        },
        {
          addr: "0x0000000000000000000000000000000000008001",
          name: /EmptyContract/,
        },
        {
          addr: "0x0000000000000000000000000000000000008002",
          name: /AccountCodeStorage/,
        },
        {
          addr: "0x0000000000000000000000000000000000008003",
          name: /NonceHolder/,
        },
        {
          addr: "0x0000000000000000000000000000000000008004",
          name: /KnownCodesStorage/,
        },
        {
          addr: "0x0000000000000000000000000000000000008005",
          name: /ImmutableSimulator/,
        },
        {
          addr: "0x0000000000000000000000000000000000008006",
          name: "ContractDeployer",
        },

        {
          addr: "0x0000000000000000000000000000000000008006",
          name: "ContractDeployer",
        },
        {
          addr: "0x0000000000000000000000000000000000008008",
          name: "L1Messenger",
        },
        {
          addr: "0x0000000000000000000000000000000000008009",
          name: "MsgValueSimulator",
        },
        {
          addr: "0x000000000000000000000000000000000000800a",
          name: "L2BaseToken",
        },
        {
          addr: "0x0000000000000000000000000000000000008006",
          name: "ContractDeployer",
        },
        {
          addr: "0x000000000000000000000000000000000000800b",
          name: "SystemContext",
        },
        {
          addr: "0x000000000000000000000000000000000000800c",
          name: "BootloaderUtilities",
        },

        {
          addr: "0x000000000000000000000000000000000000800d",
          name: "EventWriter",
        },
        {
          addr: "0x000000000000000000000000000000000000800c",
          name: "BootloaderUtilities",
        },
        {
          addr: "0x000000000000000000000000000000000000800e",
          name: "Compressor",
        },
        {
          addr: "0x000000000000000000000000000000000000800f",
          name: "ComplexUpgrader",
        },
        {
          addr: "0x0000000000000000000000000000000000008010",
          name: "Keccak256",
        },
        {
          addr: "0x0000000000000000000000000000000000008012",
          name: "CodeOracle",
        },
        {
          addr: "0x0000000000000000000000000000000000000100",
          name: "P256Verify",
        },
        {
          addr: "0x0000000000000000000000000000000000008011",
          name: "PubdataChunkPublisher",
        },
      ];

      for (const { addr, name } of l2Contracts) {
        const empty1 = await state.dataForL2Address(addr as Hex);
        expect(empty1.name).toMatch(new RegExp(name));
      }
    });
  });
});
