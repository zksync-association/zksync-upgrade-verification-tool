import { bytesToBigInt, bytesToNumber, type Hex, hexToBytes, hexToNumber } from "viem";
import type { FacetData, SystemContractData } from "./upgrade-changes";
import { Option } from "nochoices";
import { InconsistentData, MissingRequiredProp } from "./errors";
import { undefined } from "zod";

export type L2ContractData = {
  address: Hex;
  bytecodeHash: Hex;
  name: string;
};

export enum PubdataPricingMode {
  Rollup = 0,
  Validium = 1,
}

export type FeeParams = {
  pubdataPricingMode: PubdataPricingMode;
  batchOverheadL1Gas: bigint;
  maxPubdataPerBatch: bigint;
  maxL2GasPerBatch: bigint;
  priorityTxMaxPubdata: bigint;
  minimalL2GasPrice: bigint;
};

export type HexEraPropNames =
  | "admin"
  | "pendingAdmin"
  | "verifierAddress"
  | "bridgeHubAddress"
  | "blobVersionedHashRetriever"
  | "stateTransitionManagerAddress"
  | "l2DefaultAccountBytecodeHash"
  | "l2BootloaderBytecodeHash"
  | "chainId";

export type NumberEraPropNames =
  | "baseTokenGasPriceMultiplierNominator"
  | "baseTokenGasPriceMultiplierDenominator";

export type ZkEraStateData = {
  admin?: Hex;
  pendingAdmin?: Hex;
  verifierAddress?: Hex;
  bridgeHubAddress?: Hex;
  blobVersionedHashRetriever?: Hex;
  stateTransitionManagerAddress?: Hex;
  l2DefaultAccountBytecodeHash?: Hex;
  l2BootloaderBytecodeHash?: Hex;
  protocolVersion?: Hex;
  chainId?: Hex;
  baseTokenGasPriceMultiplierNominator?: bigint;
  baseTokenGasPriceMultiplierDenominator?: bigint;
};

export interface SystemContractProvider {
  dataFor(addr: Hex): Promise<L2ContractData>;
}

export class SystemContractList implements SystemContractProvider {
  private data: L2ContractData[];

  constructor(data: L2ContractData[]) {
    this.data = data;
  }

  async dataFor(addr: Hex): Promise<L2ContractData> {
    const find = this.data.find((l2) => l2.address === addr);
    if (!find) {
      throw new InconsistentData(`Missing system contract data for "${addr}".`);
    }
    return find;
  }
}

export class CurrentZksyncEraState {
  data: ZkEraStateData;
  private facets: FacetData[];
  private systemContracts: SystemContractProvider;

  constructor(data: ZkEraStateData, facets: FacetData[], systemContracts: SystemContractProvider) {
    this.data = data;
    this.facets = facets;
    this.systemContracts = systemContracts;
  }

  // METADATA

  protocolVersion(): string {
    if (!this.data.protocolVersion) {
      throw new MissingRequiredProp("protocolVersion");
    }
    const bytes = Buffer.from(hexToBytes(this.data.protocolVersion));

    const subarray = bytes.subarray(0, 28);
    if (bytesToBigInt(subarray) === 0n) {
      return hexToNumber(this.data.protocolVersion).toString();
    }

    const patch = bytesToNumber(bytes.subarray(28, 32));
    const minor = bytesToNumber(bytes.subarray(25, 28));
    const major = bytesToNumber(bytes.subarray(21, 25));

    return `${major}.${minor}.${patch}`;
  }

  // DIAMOND DATA

  allFacets(): FacetData[] {
    return this.facets;
  }

  // FEE

  feeParams(): FeeParams {
    return {
      batchOverheadL1Gas: 0n,
      maxL2GasPerBatch: 0n,
      maxPubdataPerBatch: 0n,
      minimalL2GasPrice: 0n,
      priorityTxMaxPubdata: 0n,
      pubdataPricingMode: PubdataPricingMode.Rollup,
    };
  }

  // L2 CONTRACTS

  async dataForL2Address(addr: Hex): Promise<L2ContractData> {
    return this.systemContracts.dataFor(addr);
  }

  // SimpleProps

  hexAttrValue(prop: HexEraPropNames): Option<Hex> {
    return Option.fromNullable(this.data[prop]);
  }

  numberAttrValue(name: NumberEraPropNames): Option<bigint> {
    return Option.fromNullable(this.data[name]);
  }
}
