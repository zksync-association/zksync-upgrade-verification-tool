import {createPublicClient, type Hex, http} from 'viem';

export async function contractRead (target: string, callData: string): Promise<Hex> {
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