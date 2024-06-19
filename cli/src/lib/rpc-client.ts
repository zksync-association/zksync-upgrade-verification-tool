import type { Network } from "./constants.js";
import {
  type Abi,
  createPublicClient,
  decodeFunctionResult,
  encodeFunctionData,
  type Hex,
  http, numberToHex,
} from "viem";
import type { TypeOf, ZodType } from "zod";
import type { PublicClient, HttpTransport } from "viem";
import { memoryDiffParser, type MemoryDiffRaw } from "../schema/rpc";
import {getStorageAt} from "viem/actions";

const L1_DEFAULT_URLS = {
  mainnet: "https://ethereum-rpc.publicnode.com",
  sepolia: "https://ethereum-sepolia-rpc.publicnode.com",
};

const L2_DEFAULT_URLS = {
  mainnet: "https://mainnet.era.zksync.io",
  sepolia: "https://sepolia.era.zksync.dev",
};

export class RpcClient {
  private viemClient: PublicClient<HttpTransport>;

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

  async storageRead(addr: Hex, position: bigint): Promise<Hex> {
    const readedValue = await getStorageAt(this.viemClient, {
      address: addr,
      slot: numberToHex(position, { size: 32 })
    })

    if (!readedValue) {
      throw new Error("Error reading storage")
    }
  
    return readedValue
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

  async debugTraceCall(from: string, to: string, callData: string): Promise<MemoryDiffRaw> {
    const res = await fetch(this.rpcUrl(), {
      method: "POST",
      body: JSON.stringify({
        method: "debug_traceCall",
        id: 1,
        jsonrpc: "2.0",
        params: [
          {
            from,
            to,
            data: callData,
          },
          "latest",
          {
            tracer: "prestateTracer",
            tracerConfig: {
              diffMode: true,
            },
          },
        ],
      }),
    });

    const data = await res.json();

    return memoryDiffParser.parse(data);
  }

  async netVersion(): Promise<string> {
    return this.viemClient.request({
      method: "net_version"
    })
  }
}
