import {type Abi, type AbiFunction, toFunctionSelector} from "viem";
import {ETHERSCAN_ENDPOINTS, type Network} from "./constants.js";
import {type Account20String, account20String, getAbiSchema, type HashString} from "../schema";
import type {EtherscanClient} from "./etherscan-client.js";

const buildQueryString = (endpoint: HashString, address: Account20String, apiToken: string) => {
  return `${endpoint}?module=contract&action=getabi&address=${address}&apikey=${apiToken}`;
}

export class AbiSet {
  private abis: Map<string, Abi>
  private selectors: Map<string, AbiFunction>
  private contractNames: Map<string, string>
  private client: EtherscanClient;

  constructor(client: EtherscanClient) {
    this.abis = new Map()
    this.selectors = new Map()
    this.contractNames = new Map()
    this.client = client
  }

  async fetch(address: string, name?: string): Promise<Abi> {
    if (this.abis.has(address)) {
      return this.abis.get(address)!
    }
    const abi = await this.client.getAbi(address)
    this.add(address, name || 'unknown name', abi)
    return abi
  }

  private add(address: string, name: string, abi: Abi) {
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

  static forL1(client: EtherscanClient): AbiSet {
    return new this(client)
  }

  static forL2(client: EtherscanClient): AbiSet {
    return new this(client)
  }
}