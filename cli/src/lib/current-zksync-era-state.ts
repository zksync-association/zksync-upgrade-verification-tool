import { bytesToBigInt, bytesToNumber, type Hex, hexToBytes, hexToNumber } from "viem";
import type { FacetData } from "./upgrade-changes";
import { Option } from "nochoices";
import { MissingRequiredProp } from "./errors";
import { DIAMOND_ADDRS, type Network } from "./constants";
import { Diamond } from "./diamond";
import { BlockExplorerClient } from "./block-explorer-client";
import { RpcClient } from "./rpc-client";
import { zodHex } from "../schema/zod-optionals";
import { RpcStorageSnapshot } from "./storage/rpc-storage-snapshot";
import { StringStorageVisitor } from "./reports/string-storage-visitor";
import { MAIN_CONTRACT_FIELDS } from "./storage/storage-props";
import {
  RpcSystemContractProvider,
  type SystemContractProvider,
} from "./system-contract-providers";

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
  | "l2BootloaderBytecodeHash";

export type NumberEraPropNames =
  | "baseTokenGasPriceMultiplierNominator"
  | "baseTokenGasPriceMultiplierDenominator"
  | "chainId";

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
  chainId?: bigint;
  baseTokenGasPriceMultiplierNominator?: bigint;
  baseTokenGasPriceMultiplierDenominator?: bigint;
};

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

  static async fromCallData(bytes: Buffer, network: Network): Promise<CurrentZksyncEraState> {
    const addr = DIAMOND_ADDRS[network];
    const diamond = new Diamond(addr);
    const explorer = BlockExplorerClient.forL1("IA817WPSNENBAK9EE3SNM1C5C31YUTZ4MV", network);
    const rpc = RpcClient.forL1(network);
    await diamond.init(explorer, rpc);
    await diamond.init(explorer, rpc);
    const facets = diamond.allFacets();

    const memorySnapshot = new RpcStorageSnapshot(rpc, addr);
    const visitor = new StringStorageVisitor();

    const blobVersionedHashRetrieverOpt = (
      await MAIN_CONTRACT_FIELDS.blobVersionedHashRetriever.extract(memorySnapshot)
    )
      .map((prop) => prop.accept(visitor))
      .map((prop) => prop as Hex);
    const chainIdOpt = (await MAIN_CONTRACT_FIELDS.chainId.extract(memorySnapshot))
      .map((prop) => prop.accept(visitor))
      .map((prop) => BigInt(prop));
    const baseTokenGasPriceMultiplierNominatorOpt = (
      await MAIN_CONTRACT_FIELDS.baseTokenGasPriceMultiplierNominator.extract(memorySnapshot)
    )
      .map((prop) => prop.accept(visitor))
      .map((prop) => BigInt(prop));
    const baseTokenGasPriceMultiplierDenominatorOpt = (
      await MAIN_CONTRACT_FIELDS.baseTokenGasPriceMultiplierDenominator.extract(memorySnapshot)
    )
      .map((prop) => prop.accept(visitor))
      .map((prop) => BigInt(prop));

    const data: ZkEraStateData = {
      admin: await diamond.contractRead(rpc, "getAdmin", zodHex),
      pendingAdmin: await diamond.contractRead(rpc, "getPendingAdmin", zodHex),
      verifierAddress: await diamond.contractRead(rpc, "getVerifier", zodHex),
      bridgeHubAddress: await diamond.contractRead(rpc, "getBridgehub", zodHex),
      stateTransitionManagerAddress: await diamond.contractRead(
        rpc,
        "getStateTransitionManager",
        zodHex
      ),
      l2DefaultAccountBytecodeHash: await diamond.contractRead(
        rpc,
        "getL2DefaultAccountBytecodeHash",
        zodHex
      ),
      l2BootloaderBytecodeHash: await diamond.contractRead(
        rpc,
        "getL2BootloaderBytecodeHash",
        zodHex
      ),
    };

    blobVersionedHashRetrieverOpt.ifSome((value) => {
      data.blobVersionedHashRetriever = value;
    });

    chainIdOpt.ifSome((value) => {
      data.chainId = value;
    });

    baseTokenGasPriceMultiplierNominatorOpt.ifSome((value) => {
      data.baseTokenGasPriceMultiplierNominator = value;
    });

    baseTokenGasPriceMultiplierDenominatorOpt.ifSome((value) => {
      data.baseTokenGasPriceMultiplierDenominator = value;
    });

    return new CurrentZksyncEraState(
      data,
      facets,
      new RpcSystemContractProvider(RpcClient.forL2(network), BlockExplorerClient.forL2(network))
    );
  }
}
