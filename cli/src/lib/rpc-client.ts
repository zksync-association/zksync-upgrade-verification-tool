import type {Network} from "./constants.js";
import {type Abi, createPublicClient, decodeFunctionResult, encodeFunctionData, type Hex, http} from "viem";
import type {TypeOf, ZodType} from "zod";

const DEFAULT_URLS = {
  mainnet: "https://ethereum-rpc.publicnode.com",
  sepolia: "https://ethereum-sepolia-rpc.publicnode.com",
}

export class RpcClient {
  private viemClient: ReturnType<typeof createPublicClient>;

  constructor (network: Network, url?: string) {
    this.viemClient = createPublicClient({
      transport: http(url || DEFAULT_URLS[network])
    })
  }

  rpcUrl (): string {
    return (this.viemClient?.transport?.url) as string
  }

  async contractReadRaw(target: string, callData: string): Promise<Hex> {
    const { data } = await this.viemClient.call({
      to: target as `0x${string}`,
      data: callData as `0x${string}`,
    })

    if (!data) {
      throw new Error("Unexpected response from RPC");
    }

    return data;
  }

  async contractRead<T extends ZodType>(
    target: string,
    fnName: string,
    abi: Abi,
    parser: T
  ): Promise<TypeOf<typeof parser>> {
    const callData = encodeFunctionData({
      abi,
      functionName: fnName,
    });

    const hexValue = await this.contractReadRaw(target, callData);
    const rawValue = decodeFunctionResult({
      abi,
      functionName: fnName,
      data: hexValue,
    });

    return parser.parse(rawValue);
  }
}