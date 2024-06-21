import type {Hex} from "viem";
import type {FacetData} from "./upgrade-changes";
import {Option} from "nochoices";

export type L2ContractData = {
  address: Hex,
  bytecodeHash: Hex,
  name: string
}

export enum PubdataPricingMode {
  Rollup,
  Validium
}

export type FeeParams = {
  pubdataPricingMode: PubdataPricingMode
  batchOverheadL1Gas: bigint,
  maxPubdataPerBatch: bigint,
  maxL2GasPerBatch: bigint,
  priorityTxMaxPubdata: bigint,
  minimalL2GasPrice: bigint
}

export type HexEraPropNames =
  "admin" |
  "pendingAdmin" |
  "verifierAddress" |
  "bridgeHubAddress" |
  "blobVersionedHashRetriever" |
  "stateTransitionManagerAddress" |
  "l2DefaultAccountBytecodeHash" |
  "l2BootloaderBytecodeHash"

export type NumberEraPropNames =
  "baseTokenGasPriceMultiplierNominator" |
  "baseTokenGasPriceMultiplierDenominator"

export type ZkEraStateData = {
  admin?: Hex,
  pendingAdmin?: Hex,
  verifierAddress?: Hex,
  bridgeHubAddress?: Hex,
  blobVersionedHashRetriever?: Hex,
  stateTransitionManagerAddress?: Hex,
  l2DefaultAccountBytecodeHash?: Hex,
  l2BootloaderBytecodeHash?: Hex,
  baseTokenGasPriceMultiplierNominator?: bigint,
  baseTokenGasPriceMultiplierDenominator?: bigint
}

export class CurrentZksyncEraState {
  data: ZkEraStateData

  constructor (data: ZkEraStateData) {
    this.data = data
  }

  // METADATA

  protocolVersion(): string {
    return ""
  }

  chainId(): string {
    return ""
  }

  // DIAMOND DATA

  facetAddressForSelector(selector: Hex): Hex {
    return "0x0"
  }

  selectorsForFacet(addr: Hex): Hex[] {
    return []
  }

  allSelectors (): Hex[] {
    return []
  }

  allFacetsAddresses (): Hex[] {
    return []
  }

  allFacets(): FacetData[] {
    return []
  }


  // FEE

  feeParams(): FeeParams {
    return {
      batchOverheadL1Gas: 0n,
      maxL2GasPerBatch: 0n,
      maxPubdataPerBatch: 0n,
      minimalL2GasPrice: 0n,
      priorityTxMaxPubdata: 0n,
      pubdataPricingMode: PubdataPricingMode.Rollup
    }
  }

  // L2 CONTRACTS

  l2DefaultAccountBytecodeHash(): Hex {
    return "0x0"
  }

  l2BootloaderBytecodeHash(): Hex {
    return "0x0"
  }

  dataForL2Address(addr: Hex): L2ContractData {
    return {
      address: addr,
      bytecodeHash: "0x0",
      name: "name"
    }
  }

  // SimpleProps

  hexAttrValue(prop: HexEraPropNames): Option<Hex> {
    return Option.fromNullable(this.data[prop])
  }

  numberAttrValue(name: NumberEraPropNames): Option<bigint> {
    return Option.fromNullable(this.data[name])
  }
}
