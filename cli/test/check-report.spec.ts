import { describe, it, expect } from "vitest";
import {CheckReport} from "../src/lib/reports/check-report";
import {NewZkSyncEraDiff} from "../src/lib/new-zk-sync-era-diff";
import {CurrentZksyncEraState} from "../src/lib/current-zksync-era-state";
import {SystemContractList} from "../src/lib/system-contract-providers";
import {EraContractsRepo} from "../src/lib/era-contracts-repo";
import {TestBlockExplorer} from "./utilities/test-block-explorer";
import type {Abi} from "viem";
import {ContractAbi} from "../src/lib/contract-abi";

const removedFacetAbi = new ContractAbi([
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

const upgradedFacetBefore = new ContractAbi([
  {
    type: 'function',
    name: "f1",
    inputs: [],
    outputs: [],
    stateMutability: "nonpayable"
  }
])

const upgradedFacetAfter = new ContractAbi([
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

describe('CheckReport', () => {
  it("works", async () => {
    const current = new CurrentZksyncEraState({
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
        address: "0x0101010101",
        selectors: removedFacetAbi.allSelectors()
      },
      {
        name: "UpgradedFacet",
        address: "0x0202020202",
        selectors: upgradedFacetBefore.allSelectors()
      }
    ], new SystemContractList([]))
    const proposed = new CurrentZksyncEraState({
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
        address: "0x0202020203",
        selectors: upgradedFacetAfter.allSelectors()
      }
    ], new SystemContractList([]))
    const diff = new NewZkSyncEraDiff(current, proposed, [])
    const repo = await EraContractsRepo.default()
    const explorer = new TestBlockExplorer();

    explorer.registerAbi(removedFacetAbi, "0x0101010101")
    explorer.registerAbi(upgradedFacetBefore, "0x0202020202")
    explorer.registerAbi(upgradedFacetAfter, "0x0202020203")

    const report = new CheckReport(diff, repo, explorer);
    console.log(await report.format())
  })
});