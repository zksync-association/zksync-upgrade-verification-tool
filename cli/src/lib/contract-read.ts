import {
  type Abi,
  createPublicClient,
  decodeFunctionResult,
  encodeFunctionData,
  type Hex,
  http,
} from "viem";
import type { ZodType, TypeOf } from "zod";
import type {Network} from "./constants.js";

export async function contractReadRaw(network: Network, target: string, callData: string): Promise<Hex> {
  const urls = {
    mainnet: "https://ethereum-rpc.publicnode.com",
    sepolia: "https://ethereum-sepolia-rpc.publicnode.com"
  }

  const client = createPublicClient({
    transport: http(urls[network]),
  });
  const { data } = await client.call({
    to: target as `0x${string}`,
    data: callData as `0x${string}`,
  });

  if (!data) {
    throw new Error("Unexpected response from RPC");
  }

  return data;
}

export async function contractRead<T extends ZodType>(
  network: Network,
  target: string,
  fnName: string,
  abi: Abi,
  parser: T
): Promise<TypeOf<typeof parser>> {
  const callData = encodeFunctionData({
    abi,
    functionName: fnName,
  });

  const hexValue = await contractReadRaw(network, target, callData);
  const rawValue = decodeFunctionResult({
    abi,
    functionName: fnName,
    data: hexValue,
  });

  return parser.parse(rawValue);
}
