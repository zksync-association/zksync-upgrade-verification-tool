import type {AbiSet} from "./abi-set.js";
import {contractRead} from "./contract-read.js";
import {decodeFunctionResult} from "viem";
import {facetsResponseSchema} from "../schema/new-facets.js";
import type {RawSourceCode} from "../schema/source-code-response.js";
import type {FacetChanges} from "./reports/facet-changes.js";
import type {BlockExplorerClient} from "./block-explorer-client.js";
import path from "node:path";
import fs from "node:fs/promises";
import CliTable from "cli-table3";

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


  async init (client: BlockExplorerClient) {
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

    for (const facet of facets) {
      this.facetToSelectors.set(facet.addr, facet.selectors)
      for (const selector of facet.selectors) {
        this.selectorToFacet.set(selector, facet.addr)
      }
    }

    const promises = facets.map(async facet => {
      const source = await client.getSourceCode(facet.addr)
      this.facetToContractData.set(facet.addr, source)
    })
    await Promise.all(promises)
  }

  async calculateDiff (changes: FacetChanges, client: BlockExplorerClient): Promise<DiamondDiff> {
    const diff = new DiamondDiff();

    for (const [address, data] of this.facetToContractData.entries()) {
      const change = changes.facetAffected(data.name)
      if (change && change.address !== address) {
        const newContractData = await client.getSourceCode(change.address)
        const oldFacets = this.facetToSelectors.get(address)
        if (!oldFacets) { throw new Error('Inconsistent data')}

        diff.add(address, change.address, data.name, data, newContractData, oldFacets, change.selectors)
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
    newData: ContractData,
    oldSelectors: string[]
    newSelectors: string[]
  }[]


  constructor () {
    this.changes = []
  }

  add (oldAddress: string, newAddress: string, name: string, oldData: ContractData, newData: ContractData, oldSelectors: string[], newSelectors: string[]): void {
    this.changes.push({
      oldAddress,
      newAddress,
      name,
      oldData,
      newData,
      oldSelectors,
      newSelectors
    })
  }

  async writeCodeDiff (baseDirPath: string): Promise<void> {
    console.log(baseDirPath)
    for (const {name, oldAddress, newAddress, oldData, newData} of this.changes) {
      const dirOld = path.join(baseDirPath, 'old', name)
      const dirNew = path.join(baseDirPath, 'new', name)

      for (const fileName in oldData.sources.sources) {
        const {content} = oldData.sources.sources[fileName]
        path.parse(fileName).dir
        const filePath = path.join(dirOld, fileName)
        await fs.mkdir(path.parse(filePath).dir, {recursive: true})
        await fs.writeFile(filePath, content)
      }

      for (const fileName in newData.sources.sources) {
        const {content} = newData.sources.sources[fileName]
        const filePath = path.join(dirNew, fileName)
        await fs.mkdir(path.parse(filePath).dir, {recursive: true})
        await fs.writeFile(filePath, content)
      }
    }
  }

  toCliReport (abis: AbiSet): string {
    const strings = ['Diamond Upgrades: \n']


    for (const change of this.changes) {
      const table = new CliTable({
        head: [change.name],
        style: { compact: true }
      })

      table.push(['Old address', change.oldAddress])
      table.push(['New address', change.newAddress])
      table.push(['New contract verified etherscan', 'Yes'])
      table.push(['To compare code', `pnpm validate download-diff -l1=${change.name} <path/to/target/folder>`])

      const newFunctions = change.newSelectors
        .filter(s => !change.oldSelectors.includes(s))
        .map(s => abis.signatureForSelector(s))

      table.push(['New Functions', newFunctions.length ? newFunctions.join(', ') : 'None'])

      strings.push(table.toString())
    }

    return strings.join('\n')
  }
}