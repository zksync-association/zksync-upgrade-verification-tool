import {beforeEach, describe, expect, it} from "vitest";
import {CheckReport} from "../src/lib/reports/check-report";
import {NewZkSyncEraDiff} from "../src/lib/new-zk-sync-era-diff";
import {CurrentZksyncEraState, type L2ContractData} from "../src/lib/current-zksync-era-state";
import {SystemContractList} from "../src/lib/system-contract-providers";
import {EraContractsRepo} from "../src/lib/era-contracts-repo";
import {TestBlockExplorer} from "./utilities/test-block-explorer";
import {ContractAbi} from "../src/lib/contract-abi";
import type {BlockExplorer} from "../src/lib";
import type {Hex} from "viem";


interface Ctx {
  abi1: ContractAbi,
  abi2: ContractAbi,
  abi3: ContractAbi,
  address1: Hex,
  address2: Hex,
  address3: Hex,
  sysAddr1: Hex,
  sysAddr2: Hex,
  sysAddr3: Hex,
  currentState: CurrentZksyncEraState,
  proposedState: CurrentZksyncEraState,
  explorer: BlockExplorer
}

function escape(str: string): string {
  return str.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&");
}

describe('CheckReport', () => {
  beforeEach<Ctx>((ctx) => {
    ctx.address1 = "0x0000000001"
    ctx.address2 = "0x0000000002"
    ctx.address3 = "0x0000000003"

    ctx.sysAddr1 = "0x0000000000000000000000000000000000000001";
    ctx.sysAddr2 = "0x0000000000000000000000000000000000000006";
    ctx.sysAddr3 = "0x0000000000000000000000000000000000000007";


    ctx.abi1 = new ContractAbi([
      {
        type: 'function',
        name: "removed1",
        inputs: [],
        outputs: [],
        stateMutability: "nonpayable"
      },
      {
        type: 'function',
        name: "removed2",
        inputs: [],
        outputs: [],
        stateMutability: "nonpayable"
      }
    ])

    ctx.abi2 = new ContractAbi([
      {
        type: 'function',
        name: "f1",
        inputs: [],
        outputs: [],
        stateMutability: "nonpayable"
      }
    ])


    ctx.abi3 = new ContractAbi([
      {
        type: 'function',
        name: "f1",
        inputs: [],
        outputs: [],
        stateMutability: "nonpayable"
      },
      {
        type: 'function',
        name: "f2",
        inputs: [],
        outputs: [],
        stateMutability: "nonpayable"
      }
    ])

    const currentSysContracts: L2ContractData[] = [
      {
        name: "Ecrecover",
        address: ctx.sysAddr1,
        bytecodeHash: "0x0100"
      },
      {
        name: "EcAdd",
        address: ctx.sysAddr2,
        bytecodeHash: "0x0200"
      }
    ]

    ctx.currentState = new CurrentZksyncEraState({
        protocolVersion: "0x000000000000000000000000000000000000000000000000000000000000000f",
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
      }, [
        {
          name: "RemovedFacet",
          address: ctx.address1,
          selectors: ctx.abi1.allSelectors()
        },
        {
          name: "UpgradedFacet",
          address: ctx.address2,
          selectors: ctx.abi2.allSelectors()
        }
      ],
      new SystemContractList(currentSysContracts)
    )

    const proposedSysContracts: L2ContractData[] = [
      {
        name: "Ecrecover",
        address: ctx.sysAddr1,
        bytecodeHash: "0x0101"
      },
      {
        name: "EcAdd",
        address: ctx.sysAddr2,
        bytecodeHash: "0x0201"
      },
      {
        name: "EcMul",
        address: ctx.sysAddr3,
        bytecodeHash: "0x0301"
      }
    ]
    ctx.proposedState = new CurrentZksyncEraState({
        protocolVersion: "0x0000000000000000000000000000000000000000000000000000001800000001",

        admin: "0x010b",
        pendingAdmin: "0x020b",
        verifierAddress: "0x030b",
        bridgeHubAddress: "0x040b",
        blobVersionedHashRetriever: "0x050b",
        stateTransitionManagerAddress: "0x060b",
        l2DefaultAccountBytecodeHash: "0x070b",
        l2BootloaderBytecodeHash: "0x080b",
        chainId: 101n,
        baseTokenGasPriceMultiplierNominator: 201n,
      }, [
        {
          name: "UpgradedFacet",
          address: ctx.address3,
          selectors: ctx.abi3.allSelectors()
        }
      ],
      new SystemContractList(proposedSysContracts)
    )

    const explorer = new TestBlockExplorer()
    explorer.registerAbi(ctx.abi1, ctx.address1)
    explorer.registerAbi(ctx.abi2, ctx.address2)
    explorer.registerAbi(ctx.abi3, ctx.address3)
    ctx.explorer = explorer
  })


  it<Ctx>("prints all the data", async (ctx) => {
    const current = ctx.currentState
    const proposed = ctx.proposedState

    const diff = new NewZkSyncEraDiff(current, proposed, [
      ctx.sysAddr1,
      ctx.sysAddr2,
      ctx.sysAddr3
    ])
    const repo = await EraContractsRepo.default()
    const report = new CheckReport(diff, repo, ctx.explorer);
    const string = await report.format();
    console.log(string)

    const lines = string.split("\n")

    const headerData = [
      {
        field: "Current version",
        value: "15"
      },
      {
        field: "Proposed version",
        value: "0.24.1"
      },{
        field: "Taking l2 contracts from",
        value: "https://github.com/matter-labs/era-contracts"
      },{
        field: "L2 contracts commit",
        value: "main (db938769)"
      }
    ]

    for (const { field, value } of headerData) {
      const line = lines.find(l => l.includes(field))
      expect(line).toBeDefined()
      expect(line).toMatch(new RegExp(`${escape(field)}.*${escape(value)}`))
    }

    const removedFacetLine = lines.findIndex(l => l.includes("RemovedFacet"))
    expect(removedFacetLine).not.toEqual(-1)
    expect(lines[removedFacetLine + 2]).toContain("Old address")
    expect(lines[removedFacetLine + 2]).toContain(ctx.address1)
    expect(lines[removedFacetLine + 4]).toContain("New address")
    expect(lines[removedFacetLine + 4]).toContain("Facet removed")
    expect(lines[removedFacetLine + 6]).toContain("Removed functions")
    expect(lines[removedFacetLine + 6]).toContain("removed1()")
    expect(lines[removedFacetLine + 7]).toContain("removed2()")
    expect(lines[removedFacetLine + 9]).toContain("New functions")
    expect(lines[removedFacetLine + 9]).toContain("None")
    expect(lines[removedFacetLine + 11]).toContain("Upgraded functions")
    expect(lines[removedFacetLine + 11]).toContain("None")


    const upgradedFacetLine = lines.findIndex(l => l.includes("UpgradedFacet"))
    expect(upgradedFacetLine).not.toEqual(-1)
    expect(lines[upgradedFacetLine + 2]).toContain("Old address")
    expect(lines[upgradedFacetLine + 2]).toContain(ctx.address2)
    expect(lines[upgradedFacetLine + 4]).toContain("New address")
    expect(lines[upgradedFacetLine + 4]).toContain(ctx.address3)
    expect(lines[upgradedFacetLine + 6]).toContain("Removed functions")
    expect(lines[upgradedFacetLine + 8]).toContain("New functions")
    expect(lines[upgradedFacetLine + 8]).toContain("f2()")
    expect(lines[upgradedFacetLine + 10]).toContain("Upgraded functions")
    expect(lines[upgradedFacetLine + 10]).toContain("f1()")
  })
});