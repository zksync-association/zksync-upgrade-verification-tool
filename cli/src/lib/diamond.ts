import { type Abi, bytesToHex, type Hex, hexToBytes, toFunctionSelector } from "viem";
import type { BlockExplorerClient, ContractData, FacetData, BlockExplorer } from "./index";
import type { ContractAbi } from "./contract-abi";
import type { RpcClient } from "./rpc-client";
import { facetsResponseSchema } from "../schema/new-facets";
import type { z, ZodType } from "zod";

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

  addressForSelector(selector: Hex): Hex {
    const address = this.selectorToFacet.get(this.sanitizeHex(selector));
    if (!address) {
      throw new Error(`Unknown selector ${selector}`);
    }
    return address;
  }

  selectorsForFacet(facet: Hex): Hex[] {
    const selectors = this.facetToSelectors.get(this.sanitizeHex(facet));
    if (selectors === undefined) {
      throw new Error(`Unknown facet ${facet}`);
    }
    return selectors;
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

  async contractRead(rpc: RpcClient, fnName: string, schema: ZodType) {
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

  decodeFunctionData<T extends z.ZodTypeAny>(buff: Buffer, schema: T): z.infer<typeof schema> {
    const selector = buff.subarray(0, 4);
    const facetAddr = this.addressForSelector(bytesToHex(selector));
    const abi = this.abiFor(facetAddr);

    return abi.decodeCallData(bytesToHex(buff), schema);
  }

  encodeFunctionData(name: string, args: any[]): Hex {
    const abi = [...this.abis.values()].find((abi) => abi.hasFunction(name));
    if (!abi) {
      throw new Error(`Expected function ${name} to be defined`);
    }
    return abi.encodeCallData(name, args);
  }

  private abiFor(facetAddr: Hex): ContractAbi {
    const abi = this.abis.get(this.sanitizeHex(facetAddr));
    if (!abi) {
      throw new Error(`Unknown facet: ${facetAddr}`);
    }
    return abi;
  }
}
