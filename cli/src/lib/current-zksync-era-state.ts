import type {Hex} from "viem";
import {undefined} from "zod";

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
  pubataPricingMode: PubdataPricingMode
  batchOverheadL1Gas: bigint,
  maxPubdataPerBatch: bigint,
  maxL2GasPerBatch: bigint,
  priorityTxMaxPubdata: bigint,
  minimalL2GasPrice: bigint
}

export class CurrentZksyncEraState {
  constructor () {
  }

  dataForL2Address(addr: Hex): L2ContractData {
    return {
      address: addr,
      bytecodeHash: "0x0",
      name: "name"
    }
  }

  stateTransitionManagerAddress(addr: Hex): Hex {
    return "0x0"
  }

  // baseToken
  // baseTokenBridge

  protocolVersion(): string {
    return ""
  }

  chainId(): string {
    return ""
  }

  bridgeHubAddress(): Hex {
    return "0x0"
  }

  blobVersionedHashRetriever(): Hex {
    return "0x0"
  }

  feeParams(): FeeParams {
    return {
      batchOverheadL1Gas: 0n,
      maxL2GasPerBatch: 0n,
      maxPubdataPerBatch: 0n,
      minimalL2GasPrice: 0n,
      priorityTxMaxPubdata: 0n,
      pubataPricingMode: PubdataPricingMode.Rollup
    }
  }

  admin(): Hex {
    return "0x0"
  }

  pendingAdmin(): Hex {
    return "0x0"
  }

  l2DefaultAccountBytecodeHash(): Hex {
    return "0x0"
  }

  l2BootloaderBytecodeHash(): Hex {
     return "0x0"
  }

  baseTokenGasPriceMultiplierNominator(): bigint {
    return 0n
  }

  baseTokenGasPriceMultiplierDenominator(): bigint {
    return 0n
  }

  verifierAddress(): Hex {
    return "0x0"
  }

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
}