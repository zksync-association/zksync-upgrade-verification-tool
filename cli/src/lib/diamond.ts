import {AbiSet} from "./abi-set.js";
import {contractRead} from "./contract-read.js";
import {decodeFunctionResult} from "viem";
import {facetsResponseSchema} from "../schema/new-facets.js";
import {type RawSourceCode, sourceCodeResponseSchema, sourceCodeSchema} from "../schema/source-code-response.js";
import type {FacetChanges} from "./reports/facet-changes.js";
import type {EtherscanClient} from "./etherscan-client.js";
import path from "node:path";
import fs from "node:fs/promises";

export class ContractData {
  name: string;
  sources: RawSourceCode;

  constructor (name: string, sources: RawSourceCode) {
    this.name = name
    this.sources = sources
  }
}

export class Diamond {
  private addr: string;
  private abis: AbiSet

  selectorToFacet: Map<string, string>
  facetToSelectors: Map<string, string[]>
  facetToContractData: Map<string, ContractData>


  constructor (addr: string, abis: AbiSet) {
    this.addr = addr
    this.abis = abis
    this.selectorToFacet = new Map()
    this.facetToSelectors = new Map()
    this.facetToContractData = new Map()
  }


  async init (client: EtherscanClient) {
    const data = await contractRead(this.addr, '0xcdffacc67a0ed62700000000000000000000000000000000000000000000000000000000')
    const facetsAddr = `0x${data.substring(26)}`

    const abi = await this.abis.fetch(facetsAddr)

    const facetsData = await contractRead(this.addr, '0x7a0ed627')
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

    const promises = facets.map(async facet => {
      const source = await client.getSourceCode(facet.addr)
      this.facetToContractData.set(facet.addr, source)
    })
    await Promise.all(promises)
  }

  async calculateDiff (changes: FacetChanges, client: EtherscanClient): Promise<DiamondDiff> {
    const diff = new DiamondDiff();

    for (const [address, data] of this.facetToContractData.entries()) {
      const change = changes.facetAffected(data.name)
      if (change && change.address !== address) {
        const newContractData = await client.getSourceCode(change.address)
        diff.add(address, change.address, data.name, data, newContractData)
      }
    }

    return diff
  }
}


export class DiamondDiff {
  changes: {
    oldAddress: string,
    newAddress: string,
    name: string,
    oldData: ContractData,
    newData: ContractData
  }[]


  constructor () {
    this.changes = []
  }

  add (oldAddress: string, newAddress: string, name: string, oldData: ContractData, newData: ContractData): void {
    this.changes.push({
      oldAddress,
      newAddress,
      name,
      oldData,
      newData
    })
  }

  async writeDiffs (baseDirPath: string): Promise<void> {
    console.log(baseDirPath)
    for (const {name, oldAddress, newAddress, oldData, newData} of this.changes) {
      const dirOld = path.join(baseDirPath, 'old', name)
      const dirNew = path.join(baseDirPath, 'new', name)

      for (const fileName in oldData.sources.sources) {
        const {content} = oldData.sources.sources[fileName]
        path.parse(fileName).dir
        const filePath = path.join(dirOld, fileName)
        await fs.mkdir(path.parse(filePath).dir, { recursive: true })
        await fs.writeFile(filePath, content)
      }

      for (const fileName in newData.sources.sources) {
        const {content} = newData.sources.sources[fileName]
        const filePath = path.join(dirNew, fileName)
        await fs.mkdir(path.parse(filePath).dir, { recursive: true })
        await fs.writeFile(filePath, content)
      }
    }
  }
}