import type { BlockExplorer } from "../src/ethereum/block-explorer-client";
import type { ContractsRepo } from "../src/reports/git-contracts-repo";
import { SystemContractList } from "../src/reports/system-contract-providers";
import { ZkSyncEraDiff } from "../src/reports/zk-sync-era-diff";
import {
  type L2ContractData,
  type ZkEraStateData,
  ZksyncEraState,
  HEX_ZKSYNC_FIELDS,
  NUMERIC_ZKSYNC_FIELDS,
} from "../src/reports/zksync-era-state";
import { Option } from "nochoices";
import { type Hex, hexToBigInt } from "viem";
import { beforeEach, describe, expect, it } from "vitest";
import { TestBlockExplorer } from "./utilities/test-block-explorer.js";
import { TestContractRepo } from "./utilities/test-contract-repo.js";
import { type CheckReportObj, ObjectCheckReport } from "../src/reports/reports/object-check-report";
import { StringCheckReport } from "../src/reports/reports/string-check-report";
import { ContractAbi } from "../src/ethereum/contract-abi";

interface Ctx {
  abi1: ContractAbi;
  abi2: ContractAbi;
  abi3: ContractAbi;
  address1: Hex;
  address2: Hex;
  address3: Hex;
  sysAddr1: Hex;
  sysAddr2: Hex;
  sysAddr3: Hex;
  sysContractsBefore: L2ContractData[];
  sysContractsAfter: L2ContractData[];
  currentFields: ZkEraStateData;
  proposedFields: ZkEraStateData;
  currentState: ZksyncEraState;
  proposedState: ZksyncEraState;
  explorer: BlockExplorer;
  contractsRepo: ContractsRepo;
  diff: ZkSyncEraDiff;
}

// biome-ignore lint/suspicious/noShadowRestrictedNames: <explanation>
function escape(str: string): string {
  return str.replace(/[\-\[\]\/{}()*+?.\\^$|]/g, "\\$&");
}

describe("CheckReport", () => {
  beforeEach<Ctx>((ctx) => {
    ctx.address1 = "0x0000000001";
    ctx.address2 = "0x0000000002";
    ctx.address3 = "0x0000000003";
    ctx.sysAddr1 = "0x0000000000000000000000000000000000000001";
    ctx.sysAddr2 = "0x0000000000000000000000000000000000000006";
    ctx.sysAddr3 = "0x0000000000000000000000000000000000000007";
  });

  // biome-ignore lint/suspicious/noDuplicateTestHooks: <explanation>
  beforeEach<Ctx>((ctx) => {
    const repo = new TestContractRepo("somegitsha", Option.Some("main"), {});

    ctx.abi1 = new ContractAbi([
      {
        type: "function",
        name: "removed1",
        inputs: [],
        outputs: [],
        stateMutability: "nonpayable",
      },
      {
        type: "function",
        name: "removed2",
        inputs: [],
        outputs: [],
        stateMutability: "nonpayable",
      },
    ]);

    ctx.abi2 = new ContractAbi([
      {
        type: "function",
        name: "f1",
        inputs: [],
        outputs: [],
        stateMutability: "nonpayable",
      },
    ]);

    ctx.abi3 = new ContractAbi([
      {
        type: "function",
        name: "f1",
        inputs: [],
        outputs: [],
        stateMutability: "nonpayable",
      },
      {
        type: "function",
        name: "f2",
        inputs: [],
        outputs: [],
        stateMutability: "nonpayable",
      },
    ]);

    ctx.sysContractsBefore = [
      {
        name: "Ecrecover",
        address: ctx.sysAddr1,
        bytecodeHash: "0x0100",
      },
      {
        name: "EcAdd",
        address: ctx.sysAddr2,
        bytecodeHash: "0x0200",
      },
    ];

    ctx.currentFields = {
      protocolVersion: hexToBigInt(
        "0x000000000000000000000000000000000000000000000000000000000000000f"
      ),
      admin: "0x010a",
      pendingAdmin: "0x020a",
      verifierAddress: "0x030a",
      bridgeHubAddress: "0x040a",
      blobVersionedHashRetriever: "0x050a",
      stateTransitionManagerAddress: "0x060a",
      l2DefaultAccountBytecodeHash: "0x070a",
      l2BootloaderBytecodeHash: "0x080a",
      baseTokenBridgeAddress: "0x090a",
      chainId: 100n,
      baseTokenGasPriceMultiplierNominator: 200n,
      baseTokenGasPriceMultiplierDenominator: 300n,
    };

    ctx.currentState = new ZksyncEraState(
      ctx.currentFields,
      [
        {
          name: "RemovedFacet",
          address: ctx.address1,
          selectors: ctx.abi1.allSelectors(),
        },
        {
          name: "UpgradedFacet",
          address: ctx.address2,
          selectors: ctx.abi2.allSelectors(),
        },
      ],
      new SystemContractList(ctx.sysContractsBefore),
      ctx.sysContractsBefore
    );

    ctx.sysContractsAfter = [
      {
        name: "Ecrecover",
        address: ctx.sysAddr1,
        bytecodeHash: "0x0101",
      },
      {
        name: "EcAdd",
        address: ctx.sysAddr2,
        bytecodeHash: "0x0201",
      },
      {
        name: "EcMul",
        address: ctx.sysAddr3,
        bytecodeHash: "0x0301",
      },
    ];
    for (const a of ctx.sysContractsAfter) {
      repo.addHash(a.name, a.bytecodeHash);
    }

    ctx.proposedFields = {
      protocolVersion: hexToBigInt(
        "0x0000000000000000000000000000000000000000000000000000001800000001"
      ),
      admin: "0x010b",
      pendingAdmin: "0x020b",
      verifierAddress: "0x030b",
      bridgeHubAddress: "0x040b",
      blobVersionedHashRetriever: "0x050b",
      stateTransitionManagerAddress: "0x060b",
      l2DefaultAccountBytecodeHash: "0x070b",
      l2BootloaderBytecodeHash: "0x080b",
      // baseTokenBridgeAddress: "0x090b" # skip this prop to test the case when a prop keeps the same.
      chainId: 101n,
      baseTokenGasPriceMultiplierNominator: 201n,
    };
    ctx.proposedState = new ZksyncEraState(
      ctx.proposedFields,
      [
        {
          name: "UpgradedFacet",
          address: ctx.address3,
          selectors: ctx.abi3.allSelectors(),
        },
      ],
      new SystemContractList(ctx.sysContractsAfter),
      ctx.sysContractsAfter
    );

    const explorer = new TestBlockExplorer();
    explorer.registerAbi(ctx.abi1, ctx.address1);
    explorer.registerAbi(ctx.abi2, ctx.address2);
    explorer.registerAbi(ctx.abi3, ctx.address3);
    ctx.explorer = explorer;
    ctx.contractsRepo = repo;
  });

  // biome-ignore lint/suspicious/noDuplicateTestHooks: <explanation>
  beforeEach<Ctx>((ctx) => {
    ctx.diff = new ZkSyncEraDiff(ctx.currentState, ctx.proposedState);
  });

  async function createReportLines(ctx: Ctx): Promise<string[]> {
    const report = new StringCheckReport(ctx.diff, ctx.contractsRepo, ctx.explorer, "0x", {
        shortOutput: false,
    });
    const string = await report.format();
    return string.split("\n");
  }

  describe("simple scenario", () => {
    it<Ctx>("Prints all the data for the header", async (ctx) => {
      const lines = await createReportLines(ctx);

      const headerData = [
        {
          field: "Current version",
          value: "15",
        },
        {
          field: "Proposed version",
          value: "0.24.1",
        },
        {
          field: "Taking l2 contracts from",
          value: "https://github.com/matter-labs/era-contracts",
        },
        {
          field: "L2 contracts commit",
          value: "main (somegitsha)",
        },
      ];

      for (const { field, value } of headerData) {
        const line = lines.find((l) => l.includes(field));
        expect(line).toBeDefined();
        expect(line).toMatch(new RegExp(`${escape(field)}.*${escape(value)}`));
      }
    });

    it<Ctx>("prints all data for facets", async (ctx) => {
      const lines = await createReportLines(ctx);

      const removedFacetLine = lines.findIndex((l) => l.includes("RemovedFacet"));
      expect(removedFacetLine).not.toEqual(-1);
      expect(lines[removedFacetLine + 2]).toContain("Old address");
      expect(lines[removedFacetLine + 2]).toContain(ctx.address1);
      expect(lines[removedFacetLine + 4]).toContain("New address");
      expect(lines[removedFacetLine + 4]).toContain("Facet removed");
      expect(lines[removedFacetLine + 6]).toContain("Removed functions");
      expect(lines[removedFacetLine + 6]).toContain("removed1()");
      expect(lines[removedFacetLine + 7]).toContain("removed2()");
      expect(lines[removedFacetLine + 9]).toContain("New functions");
      expect(lines[removedFacetLine + 9]).toContain("None");
      expect(lines[removedFacetLine + 11]).toContain("Upgraded functions");
      expect(lines[removedFacetLine + 11]).toContain("None");

      const upgradedFacetLine = lines.findIndex((l) => l.includes("UpgradedFacet"));
      expect(upgradedFacetLine).not.toEqual(-1);
      expect(lines[upgradedFacetLine + 2]).toContain("Old address");
      expect(lines[upgradedFacetLine + 2]).toContain(ctx.address2);
      expect(lines[upgradedFacetLine + 4]).toContain("New address");
      expect(lines[upgradedFacetLine + 4]).toContain(ctx.address3);
      expect(lines[upgradedFacetLine + 6]).toContain("Removed functions");
      expect(lines[upgradedFacetLine + 8]).toContain("New functions");
      expect(lines[upgradedFacetLine + 8]).toContain("f2()");
      expect(lines[upgradedFacetLine + 10]).toContain("Upgraded functions");
      expect(lines[upgradedFacetLine + 10]).toContain("f1()");
    });

    it<Ctx>("prints all the data for system contract changes", async (ctx) => {
      const lines = await createReportLines(ctx);

      for (const { name, bytecodeHash, address } of ctx.sysContractsBefore) {
        const line = lines.findIndex((l) => l.includes(name));
        expect(line).not.toEqual(-1);
        expect(lines[line]).toContain(address);
        expect(lines[line - 1]).toContain(`Current: ${bytecodeHash}`);
      }

      for (const { name, bytecodeHash, address } of ctx.sysContractsAfter) {
        const line = lines.findIndex((l) => l.includes(name));
        expect(line).not.toEqual(-1);
        expect(lines[line]).toContain(address);
        expect(lines[line + 1]).toContain(`Proposed: ${bytecodeHash}`);
        expect(lines[line + 1]).toContain("✔");
      }
    });

    it<Ctx>("prints all the field changes", async (ctx) => {
      const lines = await createReportLines(ctx);

      for (const field of HEX_ZKSYNC_FIELDS) {
        if (field === "baseTokenBridgeAddress") continue; // This property is kept the same in this test
        const line = lines.findIndex((l) => l.includes(field));
        expect(line).not.toEqual(-1);
        expect(lines[line - 1]).toContain(ctx.currentFields[field]);
      }

      for (const field of NUMERIC_ZKSYNC_FIELDS) {
        if (field === "baseTokenGasPriceMultiplierDenominator") continue; // This property is kept the same in this test
        const line = lines.findIndex((l) => l.includes(field));
        expect(line).not.toEqual(-1);
        expect(lines[line - 1]).toContain(`Current: ${ctx.currentFields[field]}`);
        const proposed = ctx.proposedFields[field];
        expect(lines[line + 1]).toContain(`Proposed: ${proposed}`);
      }
    });

    describe("ObjectCheckReport", () => {
      async function createObject(ctx: Ctx): Promise<CheckReportObj> {
        const report = new ObjectCheckReport(ctx.diff, ctx.explorer);
        return report.format();
      }

      it<Ctx>("returns the correct object", async (ctx: Ctx) => {
        const obj = await createObject(ctx);
        expect(obj.metadata).toEqual({
          currentVersion: "15",
          proposedVersion: "0.24.1",
        });
        expect(obj.facetChanges.length).toEqual(2);
        expect(obj.facetChanges).toEqual(
          expect.arrayContaining([
            {
              name: "RemovedFacet",
              oldAddress: ctx.address1,
              newAddress: undefined,
              addedFunctions: [],
              removedFunctions: ["removed1()", "removed2()"],
              preservedFunctions: [],
            },
            {
              name: "UpgradedFacet",
              oldAddress: ctx.address2,
              newAddress: ctx.address3,
              addedFunctions: ["f2()"],
              removedFunctions: [],
              preservedFunctions: ["f1()"],
            },
          ])
        );

        expect(obj.fieldChanges).toEqual(
          expect.arrayContaining([
            {
              name: "admin",
              current: "0x010a",
              proposed: "0x010b",
              type: "address",
            },
            {
              name: "pendingAdmin",
              current: "0x020a",
              proposed: "0x020b",
              type: "address",
            },
            {
              name: "verifierAddress",
              current: "0x030a",
              proposed: "0x030b",
              type: "address",
            },
            {
              name: "bridgeHubAddress",
              current: "0x040a",
              proposed: "0x040b",
              type: "address",
            },
            {
              name: "blobVersionedHashRetriever",
              current: "0x050a",
              proposed: "0x050b",
              type: "address",
            },
            {
              name: "stateTransitionManagerAddress",
              current: "0x060a",
              proposed: "0x060b",
              type: "address",
            },
            {
              name: "l2DefaultAccountBytecodeHash",
              current: "0x070a",
              proposed: "0x070b",
              type: "bytes32",
            },
            {
              name: "l2BootloaderBytecodeHash",
              current: "0x080a",
              proposed: "0x080b",
              type: "bytes32",
            },
            {
              name: "baseTokenBridgeAddress",
              current: "0x090a",
              proposed: null,
              type: "address",
            },
            {
              name: "protocolVersion",
              current: "15",
              proposed: "103079215105",
              type: "number",
            },
            {
              name: "baseTokenGasPriceMultiplierNominator",
              current: "200",
              proposed: "201",
              type: "number",
            },
            {
              name: "baseTokenGasPriceMultiplierDenominator",
              current: "300",
              proposed: null,
              type: "number",
            },
            {
              name: "chainId",
              current: "100",
              proposed: "101",
              type: "number",
            },
          ])
        );

        expect(obj.systemContractChanges.length).toEqual(3);
        expect(obj.systemContractChanges).toEqual(
          expect.arrayContaining([
            {
              name: "Ecrecover",
              address: ctx.sysAddr1,
              currentBytecodeHash: "0x0100",
              proposedBytecodeHash: "0x0101",
              recompileMatches: true,
            },
            {
              name: "EcAdd",
              address: ctx.sysAddr2,
              currentBytecodeHash: "0x0200",
              proposedBytecodeHash: "0x0201",
              recompileMatches: true,
            },
            {
              name: "EcMul",
              address: ctx.sysAddr3,
              currentBytecodeHash: undefined,
              proposedBytecodeHash: "0x0301",
              recompileMatches: true,
            },
          ])
        );
      });
    });
  });

  describe("when a system contract is not find in the repo", () => {
    beforeEach<Ctx>((ctx) => {
      const repo = new TestContractRepo("somegitsha", Option.Some("main"), {});
      // Skipping last element
      for (const a of ctx.sysContractsAfter.slice(0, 2)) {
        repo.addHash(a.name, a.bytecodeHash);
      }
      ctx.contractsRepo = repo;

      ctx.diff = new ZkSyncEraDiff(ctx.currentState, ctx.proposedState);
    });

    it<Ctx>("indicates that bytecode does not match", async (ctx) => {
      const lines = await createReportLines(ctx);

      const line = lines.findIndex((l) => l.includes(ctx.sysAddr3));
      expect(line).not.toEqual(-1);
      expect(lines[line + 1]).toContain("⚠️");
    });

    it<Ctx>("adds the warning", async (ctx) => {
      const lines = await createReportLines(ctx);

      const line = lines.findIndex((l) =>
        l.includes(`Bytecode for "EcMul" does not match after recompile from sources`)
      );
      expect(line).not.toEqual(-1);
    });
  });

  describe("when a system contract returns a non matching bytecodehash", () => {
    beforeEach<Ctx>((ctx) => {
      const repo = new TestContractRepo("somegitsha", Option.Some("main"), {});
      // Skipping last element
      for (const a of ctx.sysContractsAfter.slice(0, 2)) {
        repo.addHash(a.name, a.bytecodeHash);
      }
      // biome-ignore lint/style/noNonNullAssertion: <explanation>
      repo.addHash(ctx.sysContractsAfter[2]!.name, "WrongHash");

      ctx.contractsRepo = repo;

      ctx.diff = new ZkSyncEraDiff(ctx.currentState, ctx.proposedState);
    });

    it<Ctx>("indicates that bytecode does not match", async (ctx) => {
      const lines = await createReportLines(ctx);

      const line = lines.findIndex((l) => l.includes(ctx.sysAddr3));
      expect(line).not.toEqual(-1);
      expect(lines[line + 1]).toContain("⚠️");
    });

    it<Ctx>("adds the warning", async (ctx) => {
      const lines = await createReportLines(ctx);

      const line = lines.findIndex((l) =>
        l.includes(`Bytecode for "EcMul" does not match after recompile from sources`)
      );
      expect(line).not.toEqual(-1);
    });
  });
});
