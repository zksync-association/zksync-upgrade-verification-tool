import {
  type Abi,
  type AbiEvent,
  type AbiFunction,
  type AbiItem,
  decodeFunctionData,
  encodeFunctionData,
  type Hex,
  toEventSelector,
  toFunctionSelector,
} from "viem";
import type { z } from "zod";
import { Option } from "nochoices";

function isAbiFunction(abiElem: AbiItem): abiElem is AbiFunction {
  return abiElem.type === "function";
}

export class ContractAbi {
  raw: Abi;
  private selectors: Map<Hex, AbiFunction>;

  constructor(raw: Abi) {
    this.raw = raw;
    this.selectors = new Map();

    const fns = raw.filter((desc) => desc.type === "function") as AbiFunction[];
    for (const fn of fns) {
      const selector = toFunctionSelector(fn);
      this.selectors.set(selector, fn);
    }
  }

  allSelectors(): Hex[] {
    return [...this.selectors.keys()];
  }

  signatureForSelector(selector: Hex, long = true): string {
    const fn = this.selectors.get(selector);
    if (!fn) {
      return selector;
    }
    const params = fn.inputs.map((i) => `${i.type} ${i.name}`);
    return `${fn.name}(${long ? params.join(", ") : "..."})`;
  }

  decodeCallData<T extends z.ZodTypeAny>(callData: Hex, schema: T): z.infer<typeof schema> {
    const raw = decodeFunctionData({
      data: callData,
      abi: this.raw,
    });
    return schema.parse(raw);
  }

  encodeCallData(name: string, args: any[]): Hex {
    return encodeFunctionData({
      functionName: name,
      args: args,
      abi: this.raw,
    });
  }

  eventIdFor(eventName: string): Hex {
    const abiElem = this.raw.find((e) => e.type === "event" && e.name === eventName);
    if (!abiElem) {
      throw new Error(`Event "${eventName}" not present in abi.`);
    }
    return toEventSelector(abiElem as AbiEvent);
  }

  hasFunction(name: string): boolean {
    return this.raw.some((t) => t.type === "function" && t.name === name);
  }

  selectorForFn(name: string): Option<Hex> {
    const found = this.raw.find((t) => isAbiFunction(t) && t.name === name);

    if (found === undefined || !isAbiFunction(found)) {
      return Option.None();
    }

    return Option.Some(found).map((abiFn) => toFunctionSelector(abiFn));
  }
}
