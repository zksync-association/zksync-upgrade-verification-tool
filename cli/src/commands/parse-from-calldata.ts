import {lookupAndParse, type Network} from "../lib";
import {AbiSet} from "../lib/abi-set";
import path from "node:path";
import {decodeFunctionData, decodeFunctionResult, encodeFunctionData} from "viem";
import {facetsResponseSchema} from "../schema/new-facets";
import {executeUpgradeSchema} from "../schema/execute-upgrade-schema";
import {initCallDataSchema} from "../schema/init-call-data";

async function simpleRead(target: string, callData: string): Promise<string> {
  const response = await fetch(
    'https://eth-mainnet.g.alchemy.com/v2/f-Lt_8EsHek4y9P-VwIFD_ACa0ihw1Lm',
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

export class Diamond {
  private addr: string;
  private abis: AbiSet

  selectorToFacet: Map<string, string>
  facetToSelectors: Map<string, string[]>


  constructor(addr: string, abis: AbiSet) {
    this.addr = addr
    this.abis = abis
    this.selectorToFacet = new Map()
    this.facetToSelectors = new Map()
  }


  async init() {
    const data = await simpleRead(this.addr, '0xcdffacc67a0ed62700000000000000000000000000000000000000000000000000000000')
    const facetsAddr = `0x${data.substring(26)}`

    const abi = await this.abis.fetch(facetsAddr)

    const facetsData = await simpleRead(this.addr, '0x7a0ed627')
    const rawFacets = decodeFunctionResult({
      abi,
      functionName: 'facets',
      data: facetsData as `0x${string}`
    })


    const facets = facetsResponseSchema.parse(rawFacets)

    facets.forEach(facet => {
      this.facetToSelectors.set(facet.addr, facet.selectors)
      facet.selectors.forEach(selector => {
        this.selectorToFacet.set(selector, facet.addr)
      })
    })
  }
}


export async function parseFromCalldata(ethscanKey: string, upgradeDirectory: string, parentDirectory: string, network: Network): Promise<void> {
  const l1Abis = AbiSet.forL1(network, ethscanKey)
  const l2Abis = AbiSet.forL2('nokey')
  const basePath = path.resolve(process.cwd(), parentDirectory || "", upgradeDirectory);
  const upgrade = await lookupAndParse(basePath, network);

  const {
    data,
    target
  } = upgrade.transactions.governanceOperation.calls[0]

  const diamond = new Diamond(target, l1Abis)
  await diamond.init()

  const facetAddr = diamond.selectorToFacet.get(data.substring(0, 10))!
  const abi = await l1Abis.fetch(facetAddr)
  const decoded = decodeFunctionData({
    abi,
    data: data as `0x{string}`
  })

  const execUpgrade = executeUpgradeSchema.parse(decoded)

  const abi2 = await l1Abis.fetch(execUpgrade.args[0].initAddress)

  const {args: decoded2} = decodeFunctionData({
    abi: abi2,
    data: execUpgrade.args[0].initCalldata as `0x{string}`
  })

  if (!decoded2) {
    throw new Error('no decode 2')
  }

  const parsed2 = initCallDataSchema.parse(decoded2[0])
  // console.log(parsed2)

  const hex = parsed2.l2ProtocolUpgradeTx.to.toString(16)
  const deployAddr = '0x' + '0'.repeat(40 - hex.length) + hex
  const deploySysContractsAbi = await l2Abis.fetch(deployAddr);
  // console.log(encodeFunctionData({ abi: _abi, functionName: 'upgrade' }))

  const { args: lala} = decodeFunctionData({
    abi: deploySysContractsAbi,
    data: parsed2.l2ProtocolUpgradeTx.data as `0x{string}`
  })

  console.log(lala)
}