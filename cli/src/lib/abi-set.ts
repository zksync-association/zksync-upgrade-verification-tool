import {type Abi, type AbiFunction, toFunctionSelector} from "viem";
import {ETHERSCAN_ENDPOINTS, type Network} from "./constants.js";
import {type Account20String, account20String, getAbiSchema, type HashString} from "../schema";

const buildQueryString = (endpoint: HashString, address: Account20String, apiToken: string) => {
  return `${endpoint}?module=contract&action=getabi&address=${address}&apikey=${apiToken}`;
}

export class AbiSet {
  private abis: Map<string, Abi>
  private selectors: Map<string, AbiFunction>
  private contractNames: Map<string, string>
  private apiKey: string;
  private endpoint: string;

  constructor(endpoint: string, apiKey: string) {
    this.abis = new Map()
    this.selectors = new Map()
    this.contractNames = new Map()
    this.endpoint = endpoint
    this.apiKey = apiKey
  }

  private async fetchAbi(rawAddress: string): Promise<Abi> {
    const contractAddr = account20String.parse(rawAddress);
    const query = buildQueryString(this.endpoint, contractAddr, this.apiKey);
    const response = await fetch(query);
    const { message, result } = getAbiSchema.parse(await response.json());

    if (message !== "OK") {
      throw new Error(`Failed to fetch ABI for ${rawAddress}`);
    }

    return JSON.parse(result);
  }

  async fetch(address: string, name?: string): Promise<Abi> {
    if (this.abis.has(address)) {
      return this.abis.get(address)!
    }
    const abi = await this.fetchAbi(address)
    this.add(address, name || 'unknown name', abi)
    return abi
  }

  add(address: string, name: string, abi: Abi) {
    this.abis.set(address, abi)
    this.contractNames.set(address, name)
    const fns = abi.filter(desc => desc.type === 'function') as AbiFunction[]
    fns.forEach(fn => {
      const selector = toFunctionSelector(fn)
      this.selectors.set(selector, fn)
    })
  }

  signatureForSelector(selector: string): string {
    const fn = this.selectors.get(selector)
    if (!fn) {
      return 'unknown'
    }
    const params = fn.inputs.map(i => `${i.type} ${i.name}`)
    return `${fn.name}(${params.join(', ')})`
  }

  nameForContract(address: string): string {
    return this.contractNames.get(address) || 'Unknown Contract'
  }

  static forL1(network: Network, apiKey: string): AbiSet {
    const endpoint = ETHERSCAN_ENDPOINTS[network]
    return new this(endpoint, apiKey)
  }

  static forL2(apiKey: string): AbiSet {
    return new this('https://block-explorer-api.mainnet.zksync.io/api', apiKey)
  }
}