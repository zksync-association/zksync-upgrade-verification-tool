import type {Abi} from 'viem';
import {
  sourceCodeResponseSchema, sourceCodeSchema,
} from "../schema/source-code-response.js";
import {account20String, getAbiSchema} from "../schema/index.js";
import {ETHERSCAN_ENDPOINTS, type Network} from "./constants.js";
import {ContractData} from "./zkSyncEraState.js";

export class BlockExplorerClient {
  private apiKey: string
  private baseUri: string
  private abiCache: Map<string, Abi>
  private sourceCache: Map<string, ContractData>

  constructor (apiKey: string, baseUri: string) {
    this.apiKey = apiKey
    this.baseUri = baseUri
    this.abiCache = new Map()
    this.sourceCache = new Map()
  }

  async getAbi(rawAddress: string): Promise<Abi> {
    const existing = this.abiCache.get(rawAddress)
    if(existing) { return existing }

    const contractAddr = account20String.parse(rawAddress);

    const query = new URLSearchParams({
      module: 'contract',
      action: 'getabi',
      address: contractAddr,
      apikey: this.apiKey,
    }).toString()


    const response = await fetch(`${this.baseUri}?${query}`);
    const { message, result } = getAbiSchema.parse(await response.json());

    if (message !== "OK") {
      throw new Error(`Failed to fetch ABI for ${rawAddress}`);
    }

    const abi = JSON.parse(result);
    this.abiCache.set(rawAddress, abi)
    return abi;
  }

  async getSourceCode(rawAddress: string): Promise<ContractData> {
    const existing = this.sourceCache.get(rawAddress)
    if (existing) {
      return existing
    }

    const contractAddr = account20String.parse(rawAddress);

    const query = new URLSearchParams({
      module: 'contract',
      action: 'getsourcecode',
      address: contractAddr,
      apikey: this.apiKey,
    }).toString()

    const response = await fetch(`${this.baseUri}?${query}`);
    const { message, result } = sourceCodeResponseSchema.parse(await response.json());

    if (message !== "OK") {
      throw new Error(`Failed to Source Code for ${rawAddress}`);
    }

    if (!result[0]) {
      throw new Error(`Recieved empty Source Code for ${rawAddress}`);
    }

    const rawSourceCode = result[0].SourceCode.replace(/^\{\{/, '{').replace(/}}$/, '}')
    const SourceCode = sourceCodeSchema.parse(JSON.parse(rawSourceCode))

    const data = new ContractData(result[0].ContractName, SourceCode, contractAddr)

    this.sourceCache.set(rawAddress, data)
    return data;
  }

  static fromNetwork(apiKey: string, network: Network): BlockExplorerClient {
    const baseUri = ETHERSCAN_ENDPOINTS[network]
    return new BlockExplorerClient(apiKey, baseUri)
  }

  static forL2(): BlockExplorerClient {
    return new BlockExplorerClient('no api key needed', 'https://block-explorer-api.mainnet.zksync.io/api')
  }
}