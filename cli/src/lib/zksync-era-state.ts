import {
  bytesToBigInt,
  bytesToHex,
  bytesToNumber,
  type Hex,
  hexToBytes,
  hexToNumber,
  numberToHex,
} from "viem";
import type { FacetData } from "./upgrade-changes";
import { Option } from "nochoices";
import { MissingRequiredProp } from "./errors";
import { DIAMOND_ADDRS, type Network } from "./constants";
import { Diamond } from "./diamond";
import { type BlockExplorer, BlockExplorerClient } from "./block-explorer-client";
import { RpcClient } from "./rpc-client";
import { zodHex } from "../schema/zod-optionals";
import { RpcStorageSnapshot } from "./storage/rpc-storage-snapshot";
import { StringStorageVisitor } from "./reports/string-storage-visitor";
import { MAIN_CONTRACT_FIELDS } from "./storage/storage-props";
import {
  RpcSystemContractProvider,
  SystemContractList,
  type SystemContractProvider,
} from "./system-contract-providers";
import {
  callDataSchema,
  type FacetCut,
  l2UpgradeSchema,
  upgradeCallDataSchema,
} from "../schema/rpc";
import { z } from "zod";

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

export const ADDR_ZKSYNC_FIELDS = [
  "admin",
  "pendingAdmin",
  "verifierAddress",
  "bridgeHubAddress",
  "blobVersionedHashRetriever",
  "stateTransitionManagerAddress",
  "baseTokenBridgeAddress"
] as const

export const BYTES32_ZKSYNC_FIELDS = [
  "l2DefaultAccountBytecodeHash",
  "l2BootloaderBytecodeHash",
  "protocolVersion"
] as const

export const HEX_ZKSYNC_FIELDS = [
  ...ADDR_ZKSYNC_FIELDS,
  ...BYTES32_ZKSYNC_FIELDS] as const;

export type HexEraPropName = (typeof HEX_ZKSYNC_FIELDS)[number];

export const NUMERIC_ZKSYNC_FIELDS = [
  "baseTokenGasPriceMultiplierNominator",
  "baseTokenGasPriceMultiplierDenominator",
  "chainId",
] as const;

export type NumberEraPropNames = (typeof NUMERIC_ZKSYNC_FIELDS)[number];

export type ZkEraStateData = {
  [key in HexEraPropName]?: Hex | undefined;
} & {
  [key in NumberEraPropNames]?: bigint | undefined;
};

export class ZksyncEraState {
  data: ZkEraStateData;
  private facets: FacetData[];
  private systemContracts: SystemContractProvider;

  constructor(data: ZkEraStateData, facets: FacetData[], systemContracts: SystemContractProvider) {
    this.data = data;
    this.facets = facets;
    this.systemContracts = systemContracts;
  }

  // METADATA

  allFacetsAddrs(): Hex[] {
    return this.facets.map((f) => f.address);
  }

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

  // TODO: Include fee params
  // feeParams(): FeeParams {
  //   return {
  //     batchOverheadL1Gas: 0n,
  //     maxL2GasPerBatch: 0n,
  //     maxPubdataPerBatch: 0n,
  //     minimalL2GasPrice: 0n,
  //     priorityTxMaxPubdata: 0n,
  //     pubdataPricingMode: PubdataPricingMode.Rollup,
  //   };
  // }

  // L2 CONTRACTS

  async dataForL2Address(addr: Hex): Promise<Option<L2ContractData>> {
    return this.systemContracts.dataFor(addr);
  }

  // SimpleProps

  hexAttrValue(prop: HexEraPropName): Option<Hex> {
    return Option.fromNullable(this.data[prop]);
  }

  numberAttrValue(name: NumberEraPropNames): Option<bigint> {
    return Option.fromNullable(this.data[name]);
  }

  static async fromBlockchain(
    network: Network,
    explorer: BlockExplorerClient,
    rpc: RpcClient
  ): Promise<ZksyncEraState> {
    const addr = DIAMOND_ADDRS[network];
    const diamond = new Diamond(addr);

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
      protocolVersion: await diamond
        .contractRead(rpc, "getProtocolVersion", z.bigint())
        .then((n) => numberToHex(n, { size: 32 })),
      baseTokenBridgeAddress: await diamond.contractRead(rpc, "getBaseTokenBridge", zodHex),
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

    return new ZksyncEraState(
      data,
      facets,
      new RpcSystemContractProvider(RpcClient.forL2(network), BlockExplorerClient.forL2(network))
    );
  }

  static async fromCalldata(
    buff: Buffer,
    network: Network,
    explorerL1: BlockExplorerClient,
    rpc: RpcClient,
    explorerL2: BlockExplorer
  ): Promise<[ZksyncEraState, Hex[]]> {
    const addr = DIAMOND_ADDRS[network];
    const diamond = new Diamond(addr);

    await diamond.init(explorerL1, rpc);

    const decoded = diamond.decodeFunctionData(buff, callDataSchema);
    const facets = await reduceFacetCuts(decoded.args[0].facetCuts, explorerL1);

    const upgradeAddr = decoded.args[0].initAddress;
    const upgradeCalldata = decoded.args[0].initCalldata;
    const upgradeAbi = await explorerL1.getAbi(upgradeAddr);
    const decodedUpgrade = upgradeAbi.decodeCallData(upgradeCalldata, upgradeCallDataSchema);

    const hex = decodedUpgrade.args[0].l2ProtocolUpgradeTx.to.toString(16);
    const deployAddr = `0x${"0".repeat(40 - hex.length)}${hex}`;
    const deploySysContractsAbi = await explorerL2.getAbi(deployAddr);
    const decodedL2 = deploySysContractsAbi.decodeCallData(
      decodedUpgrade.args[0].l2ProtocolUpgradeTx.data,
      l2UpgradeSchema
    );

    const systemContracts: L2ContractData[] = decodedL2.args[0].map((contract) => {
      const name = Option.fromNullable(
        SYSTEM_CONTRACT_NAMES[contract.newAddress.toLowerCase() as Hex]
      );
      return {
        name: name.unwrapOr("New contract."),
        address: contract.newAddress,
        bytecodeHash: contract.bytecodeHash,
      };
    });

    const dataBlob = Buffer.from(hexToBytes(decodedUpgrade.args[0].postUpgradeCalldata));

    // TODO: Just imposible to get baseTokenGasPriceMultiplierNominator and baseTokenGasPriceMultiplierDenominator
    // from calldata. The only way is simulating the call.
    const state = new ZksyncEraState(
      {
        protocolVersion: numberToHex(decodedUpgrade.args[0].newProtocolVersion, { size: 32 }),
        verifierAddress: decodedUpgrade.args[0].verifier,
        l2DefaultAccountBytecodeHash: decodedUpgrade.args[0].defaultAccountHash,
        l2BootloaderBytecodeHash: decodedUpgrade.args[0].bootloaderHash,
        chainId: dataBlob.byteLength >= 32 ? bytesToBigInt(dataBlob.subarray(0, 32)) : undefined,
        bridgeHubAddress:
          dataBlob.byteLength >= 64 ? bytesToHex(dataBlob.subarray(32 + 12, 64)) : undefined,
        stateTransitionManagerAddress:
          dataBlob.byteLength >= 96 ? bytesToHex(dataBlob.subarray(64 + 12, 96)) : undefined,
        baseTokenBridgeAddress:
          dataBlob.byteLength >= 128 ? bytesToHex(dataBlob.subarray(96 + 12, 128)) : undefined,
        admin:
          dataBlob.byteLength >= 128 ? bytesToHex(dataBlob.subarray(128 + 12, 160)) : undefined,
      },
      facets,
      new SystemContractList(systemContracts)
    );
    return [state, systemContracts.map((l) => l.address)];
  }

  allSelectors(): Hex[] {
    return this.facets.reduce((a, b) => a.concat(b.selectors), new Array<Hex>());
  }
}

const SYSTEM_CONTRACT_NAMES: Record<Hex, string> = {
  "0x0000000000000000000000000000000000000000": "EmptyContract",
  "0x0000000000000000000000000000000000000001": "Ecrecover",
  "0x0000000000000000000000000000000000000002": "SHA256",
  "0x0000000000000000000000000000000000000006": "EcAdd",
  "0x0000000000000000000000000000000000000007": "EcMul",
  "0x0000000000000000000000000000000000000008": "EcPairing",
  "0x0000000000000000000000000000000000008001": "EmptyContract",
  "0x0000000000000000000000000000000000008002": "AccountCodeStorage",
  "0x0000000000000000000000000000000000008003": "NonceHolder",
  "0x0000000000000000000000000000000000008004": "KnownCodesStorage",
  "0x0000000000000000000000000000000000008005": "ImmutableSimulator",
  "0x0000000000000000000000000000000000008006": "ContractDeployer",
  "0x0000000000000000000000000000000000008008": "L1Messenger",
  "0x0000000000000000000000000000000000008009": "MsgValueSimulator",
  "0x000000000000000000000000000000000000800a": "L2BaseToken",
  "0x000000000000000000000000000000000000800b": "SystemContext",
  "0x000000000000000000000000000000000000800c": "BootloaderUtilities",
  "0x000000000000000000000000000000000000800d": "EventWriter",
  "0x000000000000000000000000000000000000800e": "Compressor",
  "0x000000000000000000000000000000000000800f": "ComplexUpgrader",
  "0x0000000000000000000000000000000000008010": "Keccak256",
  "0x0000000000000000000000000000000000008012": "CodeOracle",
  "0x0000000000000000000000000000000000000100": "P256Verify",
  "0x0000000000000000000000000000000000008011": "PubdataChunkPublisher",
  "0x0000000000000000000000000000000000010000": "Create2Factory",
};

async function reduceFacetCuts(cuts: FacetCut[], explorer: BlockExplorer): Promise<FacetData[]> {
  const selected = cuts.filter((cut) => cut.action === 0);

  return await Promise.all(
    selected.map(async (cut) => {
      const contract = await explorer.getSourceCode(cut.facet);
      return {
        name: contract.name,
        address: cut.facet,
        selectors: cut.selectors,
      };
    })
  );
}
