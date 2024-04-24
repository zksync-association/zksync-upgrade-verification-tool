import type {AbiSet} from "./abi-set.js";
import {contractReadRaw, contractRead} from "./contract-read-raw.js";
import {facetsResponseSchema} from "../schema/new-facets.js";
import type {RawSourceCode} from "../schema/source-code-response.js";
import type {UpgradeChanges} from "./upgrade-changes.js";
import type {BlockExplorerClient} from "./block-explorer-client.js";
import path from "node:path";
import fs from "node:fs/promises";
import CliTable from "cli-table3";
import type {Network} from "./constants.js";
import {VerifierContract} from "./verifier.js";
import {verifierParamsSchema} from "../schema/index.js";
import * as console from "node:console";
import {z} from "zod";
import {type Abi, encodeFunctionData} from "viem";

const MAIN_CONTRACT_FUNCTIONS = {
  facetAddress: 'facetAddress',
  facets: 'facets',
  getProtocolVersion: 'getProtocolVersion',
  getVerifier: 'getVerifier',
  getVerifierParams: 'getVerifierParams'
}

export class ContractData {
  name: string;
  sources: RawSourceCode;
  addr: string;

  constructor (name: string, sources: RawSourceCode, addr: string) {
    this.name = name
    this.sources = sources
    this.addr = addr
  }
}

/**
 * Class to represent the main zkSync diamond contract.
 * An instance contains the current data of the contract,
 * including its facets and selectors for each
 * facet.
 *
 * ``` js
 * const myDiamond = await Diamond.create('mainnet', client, abis)
 * ```
 */
export class ZkSyncEraState {
  private addr: string;
  private protocolVersion: bigint;
  private abis: AbiSet

  selectorToFacet: Map<string, string>
  facetToSelectors: Map<string, string[]>
  facetToContractData: Map<string, ContractData>

  private verifier?: VerifierContract


  private constructor (addr: string, abis: AbiSet) {
    this.addr = addr
    this.abis = abis
    this.selectorToFacet = new Map()
    this.facetToSelectors = new Map()
    this.facetToContractData = new Map()
    this.protocolVersion = -1n
  }

  static async create (network: Network, client: BlockExplorerClient, abis: AbiSet) {
    const addresses = {
      mainnet: '0x32400084c286cf3e17e7b677ea9583e60a000324',
      sepolia: '0x9a6de0f62aa270a8bcb1e2610078650d539b1ef9'
    }
    const diamond = new ZkSyncEraState(addresses[network], abis)
    await diamond.init(client)
    return diamond
  }


  private async findGetterFacetAbi(): Promise<Abi> {
    // Manually encode calldata becasue at this stage there
    // is no address to get the abi
    const facetAddressSelector = 'cdffacc6'
    const facetsSelector = '7a0ed627'
    const callData = `0x${facetAddressSelector}${facetsSelector}${'0'.repeat(72 - facetAddressSelector.length - facetsSelector.length)}`
    const data = await contractReadRaw(this.addr, callData)

    // Manually decode address to get abi.
    const facetsAddr = `0x${data.substring(26)}`
    return await this.abis.fetch(facetsAddr)
  }

  private async initializeFacets (abi: Abi, client: BlockExplorerClient): Promise<void> {
    const facets = await contractRead(this.addr, 'facets', abi, facetsResponseSchema)

    await Promise.all(facets.map(async facet => {
      // Get source code
      const source = await client.getSourceCode(facet.addr)
      this.facetToContractData.set(facet.addr, source)

      // Set facet and selectors data
      this.facetToSelectors.set(facet.addr, facet.selectors)
      for (const selector of facet.selectors) {
        this.selectorToFacet.set(selector, facet.addr)
      }
    }))
  }

  private async initializeProtolVersion (abi: Abi): Promise<void> {
    this.protocolVersion = await contractRead(this.addr, 'getProtocolVersion', abi, z.bigint())
  }

  private async initializeVerifier (abi: Abi): Promise<void> {
    const verifierAddress = await contractRead(this.addr, 'getVerifier', abi, z.string())
    const verifierParams =  await contractRead(this.addr, 'getVerifierParams', abi, verifierParamsSchema)
    this.verifier = new VerifierContract(
      verifierAddress,
      verifierParams.recursionCircuitsSetVksHash,
      verifierParams.recursionLeafLevelVkHash,
      verifierParams.recursionNodeLevelVkHash
    )
  }

  private async init (client: BlockExplorerClient) {
    const abi = await this.findGetterFacetAbi()

    await this.initializeFacets(abi, client)
    await this.initializeProtolVersion(abi)
    await this.initializeVerifier(abi)
  }

  async calculateDiff (changes: UpgradeChanges, client: BlockExplorerClient): Promise<ZkSyncEraDiff> {
    if (!this.verifier) {
      throw new Error('Missing verifier data')
    }

    const diff = new ZkSyncEraDiff(
      this.protocolVersion.toString(),
      changes.newProtocolVersion,
      changes.orphanedSelectors,
      this.verifier,
      changes.verifier
    );

    for (const [address, data] of this.facetToContractData.entries()) {
      const change = changes.facetAffected(data.name)
      if (change && change.address !== address) {
        const newContractData = await client.getSourceCode(change.address)
        const oldFacets = this.facetToSelectors.get(address)
        if (!oldFacets) {
          throw new Error('Inconsistent data')
        }

        diff.add(address, change.address, data.name, data, newContractData, oldFacets, change.selectors)
      }
    }


    return diff
  }
}


export class ZkSyncEraDiff {
  private oldVersion: string;
  private newVersion: string;
  private orphanedSelectors: string[]
  changes: {
    oldAddress: string,
    newAddress: string,
    name: string,
    oldData: ContractData,
    newData: ContractData,
    oldSelectors: string[]
    newSelectors: string[]
  }[]

  private oldVerifier: VerifierContract
  private newVerifier: VerifierContract


  constructor (
    oldVersion: string,
    newVersion: string,
    orphanedSelectors: string[],
    oldVerifier: VerifierContract,
    newVerifier: VerifierContract
  ) {
    this.oldVersion = oldVersion
    this.newVersion = newVersion
    this.orphanedSelectors = orphanedSelectors
    this.changes = []
    this.oldVerifier = oldVerifier
    this.newVerifier = newVerifier
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

  async writeCodeDiff (baseDirPath: string, filter: string[]): Promise<void> {
    for (const {name, oldData, newData} of this.changes) {
      if (filter.length > 0 && !filter.includes(name)) {
        continue
      }

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

  async toCliReport (abis: AbiSet, upgradeDir: string): Promise<string> {
    const strings = ['L1 upgrades: \n']

    const metadataTable = new CliTable({
      head: ['Metadata'],
      style: {compact: true}
    })
    metadataTable.push(['Current protocol version', this.oldVersion])
    metadataTable.push(['Proposed protocol version', this.newVersion])
    strings.push(metadataTable.toString())

    strings.push('Diamond upgrades:')
    for (const change of this.changes) {
      const table = new CliTable({
        head: [change.name],
        style: {compact: true}
      })

      table.push(['Current address', change.oldAddress])
      table.push(['Upgrade address', change.newAddress])
      table.push(['Proposed contract verified etherscan', 'Yes'])

      const newFunctions = await Promise.all(change.newSelectors
        .filter(s => !change.oldSelectors.includes(s))
        .map(async selector => {
          await abis.fetch(change.newAddress)
          return abis.signatureForSelector(selector)
        }))
      table.push(['New Functions', newFunctions.length ? newFunctions.join(', ') : 'None'])

      const removedFunctions = await Promise.all(change.oldSelectors
        .filter(s => this.orphanedSelectors.includes(s))
        .map(async selector => {
          await abis.fetch(change.newAddress)
          return abis.signatureForSelector(selector)
        }))

      table.push(['Removed functions', removedFunctions.length ? removedFunctions.join(', ') : 'None'])
      table.push(['To compare code', `pnpm validate show-diff ${upgradeDir} ${change.name}`])

      strings.push(table.toString())
    }


    strings.push('', 'Verifier:')
    const verifierTable = new CliTable({
      head: ['Attribute', 'Current value', 'Upgrade value'],
      style: {compact: true}
    })

    console.log(this.oldVerifier)
    console.log(this.newVerifier)

    verifierTable.push(['Address', this.oldVerifier.address, this.newVerifier.address])
    verifierTable.push(['Recursion node level VkHash', this.oldVerifier.recursionNodeLevelVkHash, this.newVerifier.recursionNodeLevelVkHash])
    verifierTable.push(['Recursion circuits set VksHash', this.oldVerifier.recursionCircuitsSetVksHash, this.newVerifier.recursionCircuitsSetVksHash])
    verifierTable.push(['Recursion leaf level VkHash', this.oldVerifier.recursionLeafLevelVkHash, this.newVerifier.recursionLeafLevelVkHash])
    strings.push(verifierTable.toString())

    return strings.join('\n')
  }
}