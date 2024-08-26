import type { Network } from "./constants.js";
import {
  type Abi,
  createPublicClient,
  decodeFunctionResult,
  encodeFunctionData,
  type Hex,
  hexToNumber,
  http,
  numberToHex,
} from "viem";
import { type TypeOf, z, type ZodType } from "zod";
import type { PublicClient, HttpTransport } from "viem";
import {
  type CallTrace,
  callTracerSchema,
  contractEventSchema,
  memoryDiffParser,
  type MemoryDiffRaw,
} from "../schema/rpc";
import { getStorageAt } from "viem/actions";

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

  async contractReadRaw(target: string, callData: string, from?: Hex, value = 0n): Promise<Hex> {
    const { data } = await this.viemClient.call({
      to: target as Hex,
      account: from,
      data: callData as Hex,
      value: value,
    });

    if (!data) {
      return "0x";
    }

    return data;
  }

  async getByteCode(addr: Hex): Promise<Hex | undefined> {
    return this.viemClient.getCode({ address: addr });
  }

  async checkContractCode(addr: Hex): Promise<boolean> {
    const code = await this.viemClient.getCode({ address: addr });
    return code !== undefined && code.length > 2;
  }

  async storageRead(addr: Hex, position: bigint): Promise<Hex> {
    const readValue = await getStorageAt(this.viemClient, {
      address: addr,
      slot: numberToHex(position, { size: 32 }),
    });

    if (!readValue) {
      throw new Error("Error reading storage");
    }

    return readValue;
  }

  async contractRead<T extends ZodType>(
    target: string,
    fnName: string,
    abi: Abi,
    parser: T,
    args: any[] = []
  ): Promise<TypeOf<typeof parser>> {
    try {
      const callData = encodeFunctionData({
        abi,
        functionName: fnName,
        args: args,
      });

      const hexValue = await this.contractReadRaw(target, callData);
      const rawValue = decodeFunctionResult({
        abi,
        functionName: fnName,
        data: hexValue,
      });

      return parser.parse(rawValue);
    } catch (e) {
      console.error(`Error calling '${fnName}' on ${target}`);
      if (e instanceof Error) {
        console.error(e.name);
        console.error(e.message);
        console.error(e.cause);
      }

      throw new Error("Error executing contract read");
    }
  }

  private async rawCall(method: string, params: any[]): Promise<any> {
    const res = await fetch(this.rpcUrl(), {
      method: "POST",
      body: JSON.stringify({
        method: method,
        id: 1,
        jsonrpc: "2.0",
        params: params,
      }),
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (!res.ok) {
      throw new Error(`Error with rpc method "${method}" (${res.status}): ${await res.text()}`);
    }

    return res.json();
  }

  async debugCallTraceStorage(from: string, to: string, callData: Hex): Promise<MemoryDiffRaw> {
    const data = await this.rawCall("debug_traceCall", [
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
    ]);

    return memoryDiffParser.parse(data);
  }

  async debugCallTraceCalls(from: string, to: string, callData: Hex): Promise<CallTrace> {
    const data = await this.rawCall("debug_traceCall", [
      {
        from,
        to,
        data: callData,
      },
      "latest",
      {
        tracer: "callTracer",
      },
    ]);

    return callTracerSchema.parse(data.result);
  }

  async netVersion(): Promise<string> {
    return this.viemClient.request({
      method: "net_version",
    });
  }

  async getLogs(address: Hex, fromBlock: string, toBLock: string, topics: Hex[] = []) {
    const arg = {
      fromBlock,
      toBlock: toBLock,
      address,
      topics,
    };

    console.log("eth_getLogs", JSON.stringify(arg, null, 2));
    const data = await this.rawCall("eth_getLogs", [arg]);

    if (data.error) {
      throw new Error(`Error getting logs: ${data.error?.message}`);
    }

    const parsed = z
      .object({
        result: z.array(contractEventSchema),
      })
      .parse(data);

    return parsed.result;
  }

  async getLatestBlock(): Promise<{ number: Hex; timestamp: number }> {
    const block = (await this.viemClient.request({
      method: "eth_getBlockByNumber",
      params: ["latest", false],
    })) as any;

    return {
      number: block.number,
      timestamp: hexToNumber(block.timestamp),
    };
  }
}
