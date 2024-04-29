import type { Abi } from "viem";
import {
  account20String,
  getAbiSchema,
  sourceCodeResponseSchema,
  sourceCodeSchema,
} from "../schema/index.js";
import { ETHERSCAN_ENDPOINTS, type Network } from "./constants.js";
import type { z, ZodType } from "zod";
import { ContractData } from "./contract-data.js";

export class BlockExplorerClient {
  private apiKey: string;
  baseUri: string;
  private abiCache: Map<string, Abi>;
  private sourceCache: Map<string, ContractData>;
  private callCount = 0;

  constructor(apiKey: string, baseUri: string) {
    this.apiKey = apiKey;
    this.baseUri = baseUri;
    this.abiCache = new Map();
    this.sourceCache = new Map();
    this.callCount = 0;
  }

  private async fetch<T extends ZodType>(
    params: Record<string, string>,
    parser: T
  ): Promise<z.infer<typeof parser>> {
    // TODO: Make an option to avoid this
    // This is to trottle the amount of request made to etherscan, because free plans
    // rate limits the calls to 5 per second.
    if (this.callCount % 5 === 4) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    const query = new URLSearchParams(params).toString();

    const response = await fetch(`${this.baseUri}?${query}`);
    this.callCount++;
    return parser.parse(await response.json());
  }

  async getAbi(rawAddress: string): Promise<Abi> {
    const existing = this.abiCache.get(rawAddress);
    if (existing) {
      return existing;
    }

    const contractAddr = account20String.parse(rawAddress);

    const { message, result } = await this.fetch(
      {
        module: "contract",
        action: "getabi",
        address: contractAddr,
        apikey: this.apiKey,
      },
      getAbiSchema
    );

    if (message !== "OK") {
      throw new Error(`Failed to fetch ABI for ${rawAddress}`);
    }

    const abi = JSON.parse(result);
    this.abiCache.set(rawAddress, abi);
    return abi;
  }

  async getSourceCode(rawAddress: string): Promise<ContractData> {
    const existing = this.sourceCache.get(rawAddress);
    if (existing) {
      return existing;
    }

    const contractAddr = account20String.parse(rawAddress);

    const { message, result } = await this.fetch(
      {
        module: "contract",
        action: "getsourcecode",
        address: contractAddr,
        apikey: this.apiKey,
      },
      sourceCodeResponseSchema
    );

    if (message !== "OK") {
      throw new Error(`Failed to Source Code for ${rawAddress}`);
    }

    if (!result[0]) {
      throw new Error(`Received empty Source Code for ${rawAddress}`);
    }

    const rawSourceCode = result[0].SourceCode.replace(/^\{\{/, "{").replace(/}}$/, "}");
    try {
      const SourceCode = sourceCodeSchema.parse(JSON.parse(rawSourceCode));
      const data = new ContractData(result[0].ContractName, SourceCode.sources, contractAddr);
      this.sourceCache.set(rawAddress, data);
      return data;
    } catch (e) {
      if (e instanceof SyntaxError) {
        const sources = { "main.sol": { content: rawSourceCode } };
        const data = new ContractData(result[0].ContractName, sources, contractAddr);
        this.sourceCache.set(rawAddress, data);
        return data;
      }
      throw e;
    }
  }

  static fromNetwork(apiKey: string, network: Network): BlockExplorerClient {
    const baseUri = ETHERSCAN_ENDPOINTS[network];
    return new BlockExplorerClient(apiKey, baseUri);
  }

  static forL2(): BlockExplorerClient {
    return new BlockExplorerClient(
      "no api key needed",
      "https://block-explorer-api.mainnet.zksync.io/api"
    );
  }
}
