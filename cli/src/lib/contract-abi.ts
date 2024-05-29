import {type Abi, type AbiFunction, toFunctionSelector} from "viem";

export class ContractAbi {
  raw: Abi
  private selectors: Map<string, AbiFunction>;

  constructor (raw: Abi) {
    this.raw = raw
    this.selectors = new Map()

    const fns = raw.filter((desc) => desc.type === "function") as AbiFunction[];
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