export async function contractRead (target: string, callData: string): Promise<string> {
  const response = await fetch(
    'https://ethereum-rpc.publicnode.com',
    {
      method: 'POST',
      body: JSON.stringify(
        {
          id: 1,
          jsonrpc: '2.0',
          method: 'eth_call',
          params: [{
            to: target,
            gas: "0xfffffff",
            gasPrice: "0x9184e72a000",
            value: "0x0",
            data: callData
          }]
        }
      )
    }
  )

  const json = await response.json() as { result: string }
  return json.result
}