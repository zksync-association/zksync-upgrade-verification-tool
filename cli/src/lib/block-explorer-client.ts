import {
  account20String,
  getAbiSchema,
  sourceCodeResponseSchema,
  sourceCodeSchema,
} from "../schema/index.js";
import { ERA_BLOCK_EXPLORER_ENDPOINTS, ETHERSCAN_ENDPOINTS, type Network } from "./constants.js";
import type { z, ZodType } from "zod";
import { ContractData } from "./contract-data.js";
import { ContracNotVerified, ExternalApiError } from "./errors.js";
import { ContractAbi } from "./contract-abi";

export interface BlockExplorer {
  getAbi(rawAddress: string): Promise<ContractAbi>;
  getSourceCode(rawAddress: string): Promise<ContractData>;
  isVerified(addr: string): Promise<boolean>;
}

export class BlockExplorerClient implements BlockExplorer {
  private apiKey: string;
  baseUri: string;
  private abiCache: Map<string, ContractAbi>;
  private sourceCache: Map<string, ContractData>;
  private contractsNotVerified: Set<string>;
  private callCount = 0;

  constructor(apiKey: string, baseUri: string) {
    this.apiKey = apiKey;
    this.baseUri = baseUri;
    this.abiCache = new Map();
    this.sourceCache = new Map();
    this.contractsNotVerified = new Set();
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
    if (!response.ok) {
      throw new ExternalApiError(
        "Block Explorer",
        `error accessing api. url=${this.baseUri}, status=${response.status}.`
      );
    }

    this.callCount++;

    return parser.parse(await response.json());
  }

  async getAbi(rawAddress: string): Promise<ContractAbi> {
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
      throw new ExternalApiError("BlockExplorer", `Cannot get abi for ${rawAddress}`);
    }

    const abi = new ContractAbi(JSON.parse(result));
    this.abiCache.set(rawAddress, abi);
    return abi;
  }

  async getSourceCode(rawAddress: string): Promise<ContractData> {
    const existing = this.sourceCache.get(rawAddress);
    if (existing) {
      return existing;
    }
    if (this.contractsNotVerified.has(rawAddress)) {
      throw new ContracNotVerified(rawAddress);
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

    if (result[0].SourceCode === "" || result[0].ABI === "Contract source code not verified") {
      throw new ContracNotVerified(rawAddress);
    }

    const abi = new ContractAbi(JSON.parse(result[0].ABI));
    this.abiCache.set(rawAddress, abi);

    try {
      const rawSourceCode = result[0].SourceCode.replace(/^\{\{/, "{").replace(/}}$/, "}");
      const SourceCode = sourceCodeSchema.parse(JSON.parse(rawSourceCode));
      const data = new ContractData(result[0].ContractName, SourceCode.sources, contractAddr);
      this.sourceCache.set(rawAddress, data);
      data.remapKeys("cache/solpp-generated-contracts", "contracts");
      return data;
    } catch (e) {
      // This means that the response was not an object, instead it was a string with the source code.
      // We cannot recreate the dir structure in this case. We also don't know the right file name or file type.
      if (e instanceof SyntaxError) {
        const content = { content: result[0].SourceCode };
        const data = new ContractData(
          result[0].ContractName,
          { "contract.sol": content },
          contractAddr
        );
        this.sourceCache.set(rawAddress, data);
        return data;
      }

      // Any other error cannot be handled
      throw e;
    }
  }

  async isVerified(addr: string): Promise<boolean> {
    try {
      await this.getSourceCode(addr);
      return true;
    } catch (e) {
      if (e instanceof ContracNotVerified) {
        return false;
      }
      throw e;
    }
  }

  static forL1(apiKey: string, network: Network): BlockExplorerClient {
    const baseUri = ETHERSCAN_ENDPOINTS[network];
    return new BlockExplorerClient(apiKey, baseUri);
  }

  static forL2(network: Network): BlockExplorerClient {
    const baseUri = ERA_BLOCK_EXPLORER_ENDPOINTS[network];
    return new BlockExplorerClient("no api key needed", baseUri);
  }
}
