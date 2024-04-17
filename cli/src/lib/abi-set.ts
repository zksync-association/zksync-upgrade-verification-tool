import {type Abi, type AbiFunction, toFunctionSelector} from "viem";
import {fetchAbi} from "./decoder.js";
import type {Network} from "./constants.js";

export class AbiSet {
  private abis: Map<string, Abi>
  private selectors: Map<string, AbiFunction>
  private network: Network
  private contractNames: Map<string, string>

  constructor (network: Network) {
    this.abis = new Map()
    this.selectors = new Map()
    this.contractNames = new Map()
    this.network = network
  }

  async fetch(address: string, name?: string): Promise<Abi> {
    const abi = await fetchAbi(this.network, address)
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

  nameForSelector (selector: string): string {
    return this.selectors.get(selector)?.name || 'unknown'
  }

  nameForContract(address: string): string {
    return this.contractNames.get(address) || 'Unknown Contract'
  }
}