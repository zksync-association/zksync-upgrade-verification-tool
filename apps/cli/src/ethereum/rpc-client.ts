import type { HttpTransport, PublicClient } from "viem";
import {
  type Abi,
  type Address,
  BaseError,
  createPublicClient,
  decodeErrorResult,
  decodeFunctionResult,
  encodeFunctionData,
  type Hex,
  http,
  numberToHex,
} from "viem";
import { type TypeOf, z, type ZodType } from "zod";
import { getStorageAt } from "viem/actions";
import { L1_DEFAULT_URLS, L2_DEFAULT_URLS, type Network } from "@repo/common/ethereum";
import { hexSchema, optionSchema } from "@repo/common/schemas";

const stateParser = z.record(
  z.string(),
  z.object({
    nonce: optionSchema(z.number()),
    storage: optionSchema(z.record(z.string(), hexSchema)),
  })
);

export const memoryDiffParser = z.object({
  result: z.object({
    post: stateParser,
    pre: stateParser,
  }),
});

export const contractEventSchema = z.object({
  address: hexSchema,
  topics: z.array(hexSchema),
  data: hexSchema,
  transactionHash: hexSchema,
  blockNumber: hexSchema,
});

const baseCallTracerSchema = z.object({
  from: z.string(),
  to: z.string(),
  input: z.string(),
});
export type CallTrace = z.infer<typeof baseCallTracerSchema> & {
  calls?: CallTrace[];
};

export const callTracerSchema: z.ZodType<CallTrace> = baseCallTracerSchema.extend({
  calls: z.lazy(() => callTracerSchema.array().optional()),
});

export type MemoryDiffRaw = z.infer<typeof memoryDiffParser>;

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
    try {
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
    } catch (e) {
      if (e instanceof BaseError) {
        const walked = e.walk() as any;
        const data = walked.data;
        const decoded = decodeErrorResult({
          data
        })
        console.error(decoded)
        throw "error doing this"
      } else {
        throw e
      }
    }

  }

  async getByteCode(addr: Hex): Promise<Hex | undefined> {
    return this.viemClient.getCode({ address: addr });
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

  async rawCall(method: string, params: any[]): Promise<any> {
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

  async traceCall(from: Address, to: Address, callData: Hex, value: bigint) {
    return await this.rawCall("debug_traceCall", [
      {
        from,
        to,
        data: callData,
        value: Number(value)
      },
      "latest",
    ])
  }

  async debugCallTraceStorage(from: Address, to: Address, callData: Hex): Promise<MemoryDiffRaw> {
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

  async balanceOf(address: Address): Promise<bigint> {
    return this.viemClient.getBalance({address, blockTag: "pending"})
  }

  // async execDebugTx(protocolHandlerAddress: Address, target: Address, data: Hex, value: bigint): Promise<void> {
  //
  // }
}
