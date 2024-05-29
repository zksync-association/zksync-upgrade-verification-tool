import type { Network } from "./constants.js";
import {
  type Abi,
  createPublicClient,
  decodeFunctionResult,
  encodeFunctionData,
  type Hex,
  http,
} from "viem";
import type { TypeOf, ZodType } from "zod";

const L1_DEFAULT_URLS = {
  mainnet: "https://ethereum-rpc.publicnode.com",
  sepolia: "https://ethereum-sepolia-rpc.publicnode.com",
};

const L2_DEFAULT_URLS = {
  mainnet: "https://mainnet.era.zksync.io",
  sepolia: "https://sepolia.era.zksync.dev",
};

export class RpcClient {
  private viemClient: ReturnType<typeof createPublicClient>;

  constructor(url: string) {
    this.viemClient = createPublicClient({
      transport: http(url),
    });
  }

  static forL1(network: Network): RpcClient {
    const url = L1_DEFAULT_URLS[network];
    return new RpcClient(url);
  }

  static forL2(network: Network): RpcClient {
    const url = L2_DEFAULT_URLS[network];
    return new RpcClient(url);
  }

  rpcUrl(): string {
    return this.viemClient?.transport?.url as string;
  }

  async contractReadRaw(target: string, callData: string): Promise<Hex> {
    const { data } = await this.viemClient.call({
      to: target as `0x${string}`,
      data: callData as `0x${string}`,
    });

    if (!data) {
      throw new Error("Unexpected response from RPC");
    }

    return data;
  }

  async getByteCode(addr: Hex): Promise<Hex | undefined> {
    return this.viemClient.getBytecode({ address: addr });
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
