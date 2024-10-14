import { type Abi, type Address, bytesToHex, type Hex, hexToBytes, toFunctionSelector } from "viem";
import type { TypeOf, ZodType } from "zod";
import { facetsResponseSchema } from "./schema/new-facets.js";
import type { FacetData } from "./upgrade-changes.js";
import type { BlockExplorer, BlockExplorerClient } from "../ethereum/block-explorer-client";
import type { ContractAbi } from "../ethereum/contract-abi";
import type { ContractData } from "../ethereum/contract-data";
import type { RpcClient } from "../ethereum/rpc-client";
import { StateTransitionManager } from "./state-transition-manager";
import { addressSchema } from "@repo/common/schemas";
import { Option } from "nochoices";

const DIAMOND_FUNCTIONS = {
  facets: "facets",
};

export class Diamond {
  address: Hex;
  facetToSelectors: Map<Hex, Hex[]>;
  selectorToFacet: Map<Hex, Hex>;
  abis: Map<Hex, ContractAbi>;
  facetToContractData: Map<Hex, ContractData>;

  constructor(address: Hex) {
    this.address = address;
    this.facetToSelectors = new Map();
    this.selectorToFacet = new Map();
    this.abis = new Map();
    this.facetToContractData = new Map();
  }

  async init(client: BlockExplorerClient, rpc: RpcClient): Promise<void> {
    const abi = await this.findGetterFacetAbi(client, rpc);

    await this.initializeFacets(abi.raw, client, rpc);
    await this.initializeAbis(client);
    await this.initializeContractData(client);
  }

  static async create(addr: Address, client: BlockExplorerClient, rpc: RpcClient): Promise<Diamond> {
    const diamond = new Diamond(addr)
    await diamond.init(client, rpc);
    return diamond;
  }

  allFacets(): FacetData[] {
    const res: FacetData[] = [];
    for (const [facet, selectors] of this.facetToSelectors.entries()) {
      res.push({
        address: facet,
        name: this.contractDataFor(facet).name,
        selectors: selectors,
      });
    }
    return res;
  }

  contractDataFor(facetAddr: Hex): ContractData {
    const data = this.facetToContractData.get(this.sanitizeHex(facetAddr));
    if (!data) {
      throw new Error(`not a diamond facet: ${facetAddr}`);
    }
    return data;
  }

  private async findGetterFacetAbi(client: BlockExplorer, rpc: RpcClient): Promise<ContractAbi> {
    // Manually encode calldata becasue at this stage there
    // is no address to get the abi
    const facetAddressSelector = "cdffacc6";
    const facetsSelector = "7a0ed627";
    const callData = `0x${facetAddressSelector}${facetsSelector}${"0".repeat(
      72 - facetAddressSelector.length - facetsSelector.length
    )}`;
    const data = await rpc.contractReadRaw(this.address, callData);

    // Manually decode address to get abi.
    const facetsAddr = `0x${data.substring(26)}`;
    return await client.getAbi(facetsAddr);
  }

  private async initializeFacets(abi: Abi, _client: BlockExplorer, rpc: RpcClient): Promise<void> {
    const facets = await rpc.contractRead(
      this.address,
      DIAMOND_FUNCTIONS.facets,
      abi,
      facetsResponseSchema
    );

    await Promise.all(
      facets.map(async (facet) => {
        // Set facet and selectors data
        this.facetToSelectors.set(this.sanitizeHex(facet.addr), facet.selectors);
        for (const selector of facet.selectors) {
          this.selectorToFacet.set(this.sanitizeHex(selector), facet.addr);
        }
      })
    );
  }

  private async initializeAbis(client: BlockExplorer): Promise<void> {
    for (const address of this.facetToSelectors.keys()) {
      const abi = await client.getAbi(address);
      this.abis.set(this.sanitizeHex(address), abi);
    }
  }

  private async initializeContractData(client: BlockExplorer): Promise<void> {
    for (const address of this.facetToSelectors.keys()) {
      const contractData = await client.getSourceCode(address);
      this.facetToContractData.set(this.sanitizeHex(address), contractData);
    }
  }

  private sanitizeHex(data: Hex): Hex {
    return bytesToHex(hexToBytes(data));
  }

  async contractRead<T extends ZodType>(rpc: RpcClient, fnName: string, schema: T): Promise<Promise<TypeOf<typeof schema>>> {
    const selector = toFunctionSelector(`${fnName}()`);
    const facetAddr = this.selectorToFacet.get(this.sanitizeHex(selector));
    if (!facetAddr) {
      throw new Error(`Function "${fnName}" does not belong to this diamond`);
    }
    const abi = this.abis.get(this.sanitizeHex(facetAddr));

    if (!abi) {
      throw new Error("Inconsistent data");
    }

    return rpc.contractRead(this.address, fnName, abi.raw, schema);
  }

  async getTransitionManager(rpc: RpcClient, explorer: BlockExplorerClient) {
    const proxyAddr = await this.contractRead(rpc, "getStateTransitionManager", addressSchema)
    return StateTransitionManager.create(proxyAddr, rpc, explorer)
  }

  selectorFor(methodName: string): Option<Hex> {
    const abi = [...this.abis.values()].find(abi => abi.hasFunction(methodName));
    return Option.fromNullable(abi)
      .map(abi => abi.selectorForFn(methodName))
      .flatten()
  }

  abiForSelector(selector: Hex): ContractAbi {
    const facet = this.selectorToFacet.get(selector)
    if (facet === undefined) {
      throw new Error(`Unknown selector ${selector}`)
    }
    const abi = this.abis.get(this.sanitizeHex(facet));
    if (abi === undefined) {
      throw new Error(`Unknown facet ${facet}`)
    }
    return abi;
  }
}
