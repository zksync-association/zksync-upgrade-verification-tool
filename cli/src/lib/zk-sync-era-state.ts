import type { AbiSet } from "./abi-set.js";
import { contractRead, contractReadRaw } from "./contract-read.js";
import { facetsResponseSchema } from "../schema/new-facets.js";
import type { SystemContractData, UpgradeChanges } from "./upgrade-changes.js";
import type { BlockExplorerClient } from "./block-explorer-client.js";
import type { Network } from "./constants.js";
import { VerifierContract } from "./verifier.js";
import { type RawSourceCode, verifierParamsSchema } from "../schema/index.js";
import { z } from "zod";
import { type Abi, createPublicClient, type Hex, http } from "viem";
import { ZkSyncEraDiff } from "./zk-sync-era-diff.js";
import path from "node:path";
import fs from "node:fs/promises";
import * as console from "node:console";
import { add } from "lodash";
import { utils } from "zksync-ethers";

const MAIN_CONTRACT_FUNCTIONS = {
  facets: "facets",
  getProtocolVersion: "getProtocolVersion",
  getVerifier: "getVerifier",
  getVerifierParams: "getVerifierParams",
};

export class ContractData {
  name: string;
  sources: RawSourceCode;
  addr: string;

  constructor(name: string, sources: RawSourceCode, addr: string) {
    this.name = name;
    this.sources = sources;
    this.addr = addr;
  }

  async writeSources(targetDir: string): Promise<void> {
    for (const fileName in this.sources.sources) {
      const { content } = this.sources.sources[fileName];
      path.parse(fileName).dir;
      const filePath = path.join(targetDir, fileName);
      await fs.mkdir(path.parse(filePath).dir, { recursive: true });
      await fs.writeFile(filePath, content);
    }
  }
}

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

  private constructor(addr: string, abis: AbiSet) {
    this.addr = addr;
    this.abis = abis;
    this.selectorToFacet = new Map();
    this.facetToSelectors = new Map();
    this.facetToContractData = new Map();
    this.protocolVersion = -1n;
  }

  static async create(network: Network, client: BlockExplorerClient, abis: AbiSet) {
    const addresses = {
      mainnet: "0x32400084c286cf3e17e7b677ea9583e60a000324",
      sepolia: "0x9a6de0f62aa270a8bcb1e2610078650d539b1ef9",
    };
    const diamond = new ZkSyncEraState(addresses[network], abis);
    await diamond.init(client);
    return diamond;
  }

  private async findGetterFacetAbi(): Promise<Abi> {
    // Manually encode calldata becasue at this stage there
    // is no address to get the abi
    const facetAddressSelector = "cdffacc6";
    const facetsSelector = "7a0ed627";
    const callData = `0x${facetAddressSelector}${facetsSelector}${"0".repeat(
      72 - facetAddressSelector.length - facetsSelector.length
    )}`;
    const data = await contractReadRaw(this.addr, callData);

    // Manually decode address to get abi.
    const facetsAddr = `0x${data.substring(26)}`;
    return await this.abis.fetch(facetsAddr);
  }

  private async initializeFacets(abi: Abi, client: BlockExplorerClient): Promise<void> {
    const facets = await contractRead(
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
    this.protocolVersion = await contractRead(
      this.addr,
      MAIN_CONTRACT_FUNCTIONS.getProtocolVersion,
      abi,
      z.bigint()
    );
  }

  private async initializeVerifier(abi: Abi): Promise<void> {
    const verifierAddress = await contractRead(
      this.addr,
      MAIN_CONTRACT_FUNCTIONS.getVerifier,
      abi,
      z.string()
    );
    const verifierParams = await contractRead(
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
      changes.verifier
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
      diff.addSystemContract(
        await this.getCurrentSystemContractData(systemContract.address),
        systemContract
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
}
