import {type Abi, createPublicClient, decodeFunctionResult, encodeFunctionData, type Hex, http} from 'viem';
import {ZodType, z, type TypeOf} from "zod";

export async function contractReadRaw (target: string, callData: string): Promise<Hex> {
  const client = createPublicClient({
    transport: http('https://ethereum-rpc.publicnode.com')
  })
  const { data} = await client.call({
    to: target as `0x${string}`,
    data: callData as `0x${string}`
  })

  if (!data) {
    throw new Error('Unexpected response from RPC')
  }

  return data
}


export async function contractRead<T extends ZodType> (target: string, fnName: string, abi: Abi, parser: T): Promise<TypeOf<typeof parser>> {
  const callData = encodeFunctionData({
    abi,
    functionName: fnName
  })

  const hexValue = await contractReadRaw(target, callData)
  const rawValue = decodeFunctionResult({
    abi,
    functionName: fnName,
    data: hexValue
  })

  return parser.parse(rawValue)
}