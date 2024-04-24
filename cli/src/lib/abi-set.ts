import { type Abi, type AbiFunction, toFunctionSelector } from "viem";
import type { BlockExplorerClient } from "./block-explorer-client.js";

export class AbiSet {
  private abis: Map<string, Abi>;
  private selectors: Map<string, AbiFunction>;
  private contractNames: Map<string, string>;
  private client: BlockExplorerClient;

  constructor(client: BlockExplorerClient) {
    this.abis = new Map();
    this.selectors = new Map();
    this.contractNames = new Map();
    this.client = client;
  }

  async fetch(address: string, name?: string): Promise<Abi> {
    const existing = this.abis.get(address);
    if (existing) {
      return existing;
    }
    const abi = await this.client.getAbi(address);
    this.add(address, name || "unknown name", abi);
    return abi;
  }

  private add(address: string, name: string, abi: Abi) {
    this.abis.set(address, abi);
    this.contractNames.set(address, name);
    const fns = abi.filter((desc) => desc.type === "function") as AbiFunction[];
    for (const fn of fns) {
      const selector = toFunctionSelector(fn);
      this.selectors.set(selector, fn);
    }
  }

  signatureForSelector(selector: string): string {
    const fn = this.selectors.get(selector);
    if (!fn) {
      return "unknown";
    }
    const params = fn.inputs.map((i) => `${i.type} ${i.name}`);
    return `${fn.name}(${params.join(", ")})`;
  }
}
