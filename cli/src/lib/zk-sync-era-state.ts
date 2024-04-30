import type { AbiSet } from "./abi-set.js";
import { facetsResponseSchema } from "../schema/new-facets.js";
import type { SystemContractData, UpgradeChanges } from "./upgrade-changes.js";
import type { BlockExplorerClient } from "./block-explorer-client.js";
import type { Network } from "./constants.js";
import { VerifierContract } from "./verifier.js";
import { verifierParamsSchema } from "../schema/index.js";
import { z } from "zod";
import { type Abi, createPublicClient, type Hex, http } from "viem";
import { ZkSyncEraDiff } from "./zk-sync-era-diff.js";
import { utils } from "zksync-ethers";
import { SystemContractChange } from "./system-contract-change";
import type { RpcClient } from "./rpc-client.js";
import type { ContractData } from "./contract-data.js";

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
  private abis: AbiSet;

  selectorToFacet: Map<string, string>;
  facetToSelectors: Map<string, string[]>;
  facetToContractData: Map<string, ContractData>;

  private verifier?: VerifierContract;
  private rpc: RpcClient;

  private _aaBytecodeHash?: string;
  private _bootloaderStringHash?: string;

  static async create(network: Network, client: BlockExplorerClient, abis: AbiSet, rpc: RpcClient) {
    const addresses = {
      mainnet: "0x32400084c286cf3e17e7b677ea9583e60a000324",
      sepolia: "0x9a6de0f62aa270a8bcb1e2610078650d539b1ef9",
    };
    const zkSyncState = new ZkSyncEraState(addresses[network], abis, rpc);
    await zkSyncState.init(client);
    return zkSyncState;
  }

  async calculateDiff(
    changes: UpgradeChanges,
    client: BlockExplorerClient
  ): Promise<ZkSyncEraDiff> {
    if (!this.verifier) {
      throw new Error("Missing verifier data");
    }

    const diff = new ZkSyncEraDiff(
      this.protocolVersion.toString(),
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
      const change = changes.facetAffected(data.name);
      if (change && change.address !== address) {
        const newContractData = await client.getSourceCode(change.address);
        const oldFacets = this.facetToSelectors.get(address);
        if (!oldFacets) {
          throw new Error("Inconsistent data");
        }

        diff.addFacet(
          address,
          change.address,
          data.name,
          data,
          newContractData,
          oldFacets,
          change.selectors
        );
      }
    }

    for (const systemContract of changes.systemCotractChanges) {
      const current = await this.getCurrentSystemContractData(systemContract.address);

      diff.addSystemContract(
        new SystemContractChange(
          systemContract.address,
          systemContract.name,
          current.codeHash,
          systemContract.codeHash
        )
      );
    }

    return diff;
  }

  async getCurrentSystemContractData(addr: Hex): Promise<SystemContractData> {
    const client = createPublicClient({
      transport: http("https://mainnet.era.zksync.io"),
    });

    const byteCode = await client.getBytecode({ address: addr });
    if (!byteCode) {
      throw new Error(`Error fetching bytecode for: ${addr}`);
    }
    const hex = Buffer.from(utils.hashBytecode(byteCode)).toString("hex");

    return {
      address: addr,
      codeHash: `0x${hex}`,
      name: "unknown",
    };
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

  private constructor(addr: string, abis: AbiSet, rpc: RpcClient) {
    this.addr = addr;
    this.abis = abis;
    this.rpc = rpc;
    this.selectorToFacet = new Map();
    this.facetToSelectors = new Map();
    this.facetToContractData = new Map();
    this.protocolVersion = -1n;
  }

  private async findGetterFacetAbi(): Promise<Abi> {
    // Manually encode calldata becasue at this stage there
    // is no address to get the abi
    const facetAddressSelector = "cdffacc6";
    const facetsSelector = "7a0ed627";
    const callData = `0x${facetAddressSelector}${facetsSelector}${"0".repeat(
      72 - facetAddressSelector.length - facetsSelector.length
    )}`;
    const data = await this.rpc.contractReadRaw(this.addr, callData);

    // Manually decode address to get abi.
    const facetsAddr = `0x${data.substring(26)}`;
    return await this.abis.fetch(facetsAddr);
  }

  private async initializeFacets(abi: Abi, client: BlockExplorerClient): Promise<void> {
    const facets = await this.rpc.contractRead(
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
    this.protocolVersion = await this.rpc.contractRead(
      this.addr,
      MAIN_CONTRACT_FUNCTIONS.getProtocolVersion,
      abi,
      z.bigint()
    );
  }

  private async initializeVerifier(abi: Abi): Promise<void> {
    const verifierAddress = await this.rpc.contractRead(
      this.addr,
      MAIN_CONTRACT_FUNCTIONS.getVerifier,
      abi,
      z.string()
    );
    const verifierParams = await this.rpc.contractRead(
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
    const abi = await this.findGetterFacetAbi();

    await this.initializeFacets(abi, client);
    await this.initializeProtolVersion(abi);
    await this.initializeVerifier(abi);
    await this.initializeSpecialContacts(abi);
  }

  private async initializeSpecialContacts(abi: Abi): Promise<void> {
    this._aaBytecodeHash = await this.rpc.contractRead(
      this.addr,
      MAIN_CONTRACT_FUNCTIONS.getL2BootloaderBytecodeHash,
      abi,
      z.string()
    );
    this._bootloaderStringHash = await this.rpc.contractRead(
      this.addr,
      MAIN_CONTRACT_FUNCTIONS.getL2DefaultAccountBytecodeHash,
      abi,
      z.string()
    );
  }
}
