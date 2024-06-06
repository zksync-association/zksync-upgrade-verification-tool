import { facetsResponseSchema } from "../schema/new-facets.js";
import type { SystemContractData, UpgradeChanges } from "./upgrade-changes.js";
import type { BlockExplorerClient } from "./block-explorer-client.js";
import type { Network } from "./constants.js";
import { VerifierContract } from "./verifier.js";
import { verifierParamsSchema } from "../schema/index.js";
import { z } from "zod";
import {type Abi, bytesToNumber, createPublicClient, type Hex, http, numberToBytes} from "viem";
import { ZkSyncEraDiff } from "./zk-sync-era-diff.js";
import { utils } from "zksync-ethers";
import { SystemContractChange } from "./system-contract-change";
import type { RpcClient } from "./rpc-client.js";
import type { ContractData } from "./contract-data.js";
import type { ContractAbi } from "./contract-abi";

const MAIN_CONTRACT_FUNCTIONS = {
  facets: "facets",
  getProtocolVersion: "getProtocolVersion",
  getVerifier: "getVerifier",
  getVerifierParams: "getVerifierParams",
  getL2BootloaderBytecodeHash: "getL2BootloaderBytecodeHash",
  getL2DefaultAccountBytecodeHash: "getL2DefaultAccountBytecodeHash",
};

/**
 * Class to represent the main zkSync diamond contract.
 * An instance contains the current data of the contract,
 * including its facets and selectors for each
 * facet.
 *
 * ``` js
 * const zkSync = await ZkSyncEraState.create('mainnet', client, abis)
 * ```
 */
export class ZkSyncEraState {
  private addr: string;
  private protocolVersion: bigint;

  selectorToFacet: Map<string, string>;
  facetToSelectors: Map<string, string[]>;
  facetToContractData: Map<string, ContractData>;

  private verifier?: VerifierContract;
  private l1Rpc: RpcClient;
  private l2Rpc: RpcClient;

  private _aaBytecodeHash?: string;
  private _bootloaderStringHash?: string;

  static async create(
    network: Network,
    client: BlockExplorerClient,
    l1Rpc: RpcClient,
    l2Rpc: RpcClient
  ) {
    const addresses = {
      mainnet: "0x32400084c286cf3e17e7b677ea9583e60a000324",
      sepolia: "0x9a6de0f62aa270a8bcb1e2610078650d539b1ef9",
    };
    const zkSyncState = new ZkSyncEraState(addresses[network], l1Rpc, l2Rpc);
    await zkSyncState.init(client);
    return zkSyncState;
  }

  get semVer (): string {
    const version = numberToBytes(this.protocolVersion, { size: 32 })
    const patch = bytesToNumber(version.subarray(28, 32))
    const minor = bytesToNumber(version.subarray(25, 28))
    const major = bytesToNumber(version.subarray(21, 25))
    return `${major}.${minor}.${patch}`
  }

  async calculateDiff(
    changes: UpgradeChanges,
    client: BlockExplorerClient
  ): Promise<ZkSyncEraDiff> {
    if (!this.verifier) {
      throw new Error("Missing verifier data");
    }

    const diff = new ZkSyncEraDiff(
      this.semVer,
      changes.newProtocolVersion,
      changes.orphanedSelectors,
      this.verifier,
      changes.verifier,
      this.aaBytecodeHash,
      changes.aaBytecodeHash,
      this.bootloaderStringHash,
      changes.booloaderBytecodeHash
    );

    for (const [address, data] of this.facetToContractData.entries()) {
      const oldSelectors = this.facetToSelectors.get(address);
      if (!oldSelectors) throw new Error("Inconsistent data");
      const change = changes.matchingFacet(oldSelectors);
      if (change && change.address !== address) {
        if (await client.isVerified(change.address)) {
          const newContractData = await client.getSourceCode(change.address);
          diff.addFacetVerifiedFacet(
            address,
            change.address,
            data,
            newContractData,
            oldSelectors,
            change.selectors
          );
        } else {
          diff.addFacetUnverifiedFacet(
            address,
            change.address,
            data,
            oldSelectors,
            change.selectors
          );
        }
      }
    }

    for (const systemContract of changes.systemContractChanges) {
      const currentBytecodeHash = await this.getCurrentSystemContractBytecodeHash(
        systemContract.address
      );

      diff.addSystemContract(
        new SystemContractChange(
          systemContract.address,
          systemContract.name,
          currentBytecodeHash,
          systemContract.codeHash
        )
      );
    }

    return diff;
  }

  async getCurrentSystemContractBytecodeHash(addr: Hex): Promise<string> {
    const byteCode = await this.l2Rpc.getByteCode(addr);

    if (!byteCode) {
      return "Not present";
    }
    const hex = Buffer.from(utils.hashBytecode(byteCode)).toString("hex");

    return `0x${hex}`;
  }

  get aaBytecodeHash(): string {
    if (!this._aaBytecodeHash) {
      throw new Error("Not initialized yet");
    }
    return this._aaBytecodeHash;
  }

  get bootloaderStringHash(): string {
    if (!this._bootloaderStringHash) {
      throw new Error("Not initialized yet");
    }
    return this._bootloaderStringHash;
  }

  constructor(addr: string, l1Rpc: RpcClient, l2Rpc: RpcClient) {
    this.addr = addr;
    this.l1Rpc = l1Rpc;
    this.l2Rpc = l2Rpc;
    this.selectorToFacet = new Map();
    this.facetToSelectors = new Map();
    this.facetToContractData = new Map();
    this.protocolVersion = -1n;
  }

  private async findGetterFacetAbi(client: BlockExplorerClient): Promise<ContractAbi> {
    // Manually encode calldata becasue at this stage there
    // is no address to get the abi
    const facetAddressSelector = "cdffacc6";
    const facetsSelector = "7a0ed627";
    const callData = `0x${facetAddressSelector}${facetsSelector}${"0".repeat(
      72 - facetAddressSelector.length - facetsSelector.length
    )}`;
    const data = await this.l1Rpc.contractReadRaw(this.addr, callData);

    // Manually decode address to get abi.
    const facetsAddr = `0x${data.substring(26)}`;
    return await client.getAbi(facetsAddr);
  }

  private async initializeFacets(abi: Abi, client: BlockExplorerClient): Promise<void> {
    const facets = await this.l1Rpc.contractRead(
      this.addr,
      MAIN_CONTRACT_FUNCTIONS.facets,
      abi,
      facetsResponseSchema
    );

    await Promise.all(
      facets.map(async (facet) => {
        // Get source code
        const source = await client.getSourceCode(facet.addr);
        this.facetToContractData.set(facet.addr, source);

        // Set facet and selectors data
        this.facetToSelectors.set(facet.addr, facet.selectors);
        for (const selector of facet.selectors) {
          this.selectorToFacet.set(selector, facet.addr);
        }
      })
    );
  }

  private async initializeProtolVersion(abi: Abi): Promise<void> {
    this.protocolVersion = await this.l1Rpc.contractRead(
      this.addr,
      MAIN_CONTRACT_FUNCTIONS.getProtocolVersion,
      abi,
      z.bigint()
    );
  }

  private async initializeVerifier(abi: Abi): Promise<void> {
    const verifierAddress = await this.l1Rpc.contractRead(
      this.addr,
      MAIN_CONTRACT_FUNCTIONS.getVerifier,
      abi,
      z.string()
    );
    const verifierParams = await this.l1Rpc.contractRead(
      this.addr,
      MAIN_CONTRACT_FUNCTIONS.getVerifierParams,
      abi,
      verifierParamsSchema
    );
    this.verifier = new VerifierContract(
      verifierAddress,
      verifierParams.recursionCircuitsSetVksHash,
      verifierParams.recursionLeafLevelVkHash,
      verifierParams.recursionNodeLevelVkHash
    );
  }

  private async init(client: BlockExplorerClient) {
    const abi = await this.findGetterFacetAbi(client);

    await this.initializeFacets(abi.raw, client);
    await this.initializeProtolVersion(abi.raw);
    await this.initializeVerifier(abi.raw);
    await this.initializeSpecialContacts(abi.raw);
  }

  private async initializeSpecialContacts(abi: Abi): Promise<void> {
    this._aaBytecodeHash = await this.l1Rpc.contractRead(
      this.addr,
      MAIN_CONTRACT_FUNCTIONS.getL2DefaultAccountBytecodeHash,
      abi,
      z.string()
    );
    this._bootloaderStringHash = await this.l1Rpc.contractRead(
      this.addr,
      MAIN_CONTRACT_FUNCTIONS.getL2BootloaderBytecodeHash,
      abi,
      z.string()
    );
  }
}
