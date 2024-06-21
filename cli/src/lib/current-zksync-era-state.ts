import {bytesToBigInt, bytesToNumber, type Hex, hexToBytes, hexToNumber} from "viem";
import type {FacetData} from "./upgrade-changes";
import {Option} from "nochoices";
import {MissingRequiredProp} from "./errors";

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
  "l2BootloaderBytecodeHash" |
  "chainId"

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
  protocolVersion?: Hex,
  chainId?: Hex,
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
    if (!this.data.protocolVersion) {
      throw new MissingRequiredProp("protocolVersion");
    }
    const bytes = Buffer.from(hexToBytes(this.data.protocolVersion))

    const subarray = bytes.subarray(0, 28)
    if (bytesToBigInt(subarray) === 0n  ) {
      return hexToNumber(this.data.protocolVersion).toString()
    }

    const patch = bytesToNumber(bytes.subarray(28, 32));
    const minor = bytesToNumber(bytes.subarray(25, 28));
    const major = bytesToNumber(bytes.subarray(21, 25));

    return `${major}.${minor}.${patch}`
  }

  chainId(): Option<Hex> {
    return Option.fromNullable(this.data.chainId)
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
