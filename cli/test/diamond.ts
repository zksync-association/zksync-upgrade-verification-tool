import type {Abi, Hex} from "viem";
import {BlockExplorerClient} from "../src/lib";
import type {ContractAbi} from "../src/lib/contract-abi";
import type {RpcClient} from "../src/lib/rpc-client";
import {facetsResponseSchema} from "../src/schema/new-facets";

const DIAMOND_FUNCTIONS = {
  facets: "facets",
};

export class Diamond {
  address: Hex
  facetToSelectors: Map<Hex, Hex[]>
  selectorToFacet: Map<Hex, Hex>
  abis: Map<Hex, ContractAbi>


  constructor(address: Hex) {
    this.address = address
    this.facetToSelectors = new Map()
    this.selectorToFacet = new Map()
    this.abis = new Map()
  }

  async init(client: BlockExplorerClient, rpc: RpcClient): Promise<void> {
    const abi = await this.findGetterFacetAbi(client, rpc);

    await this.initializeFacets(abi.raw, client, rpc)
    await this.initializeAbis(client)
  }

  private async findGetterFacetAbi(client: BlockExplorerClient, rpc: RpcClient): Promise<ContractAbi> {
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

  private async initializeFacets(abi: Abi, client: BlockExplorerClient, rpc: RpcClient): Promise<void> {
    const facets = await rpc.contractRead(
      this.address,
      DIAMOND_FUNCTIONS.facets,
      abi,
      facetsResponseSchema
    );

    await Promise.all(
      facets.map(async (facet) => {
        // Set facet and selectors data
        this.facetToSelectors.set(facet.addr, facet.selectors);
        for (const selector of facet.selectors) {
          this.selectorToFacet.set(selector, facet.addr);
        }
      })
    );
  }

  private async initializeAbis(client: BlockExplorerClient): Promise<void> {
    for (const address of this.facetToSelectors.keys()) {
      const abi = await client.getAbi(address)
      this.abis.set(address, abi)
    }
  }
}