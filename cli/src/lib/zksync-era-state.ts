import { bytesToBigInt, bytesToHex, bytesToNumber, type Hex, numberToBytes } from "viem";
import type { FacetData } from "./upgrade-changes";
import { Option } from "nochoices";
import { MissingRequiredProp } from "./errors";
import { DIAMOND_ADDRS, type Network, UPGRADE_FN_SELECTOR } from "./constants";
import { Diamond } from "./diamond";
import { type BlockExplorer, BlockExplorerClient } from "./block-explorer-client";
import { type CallsTrace, RpcClient } from "./rpc-client";
import { zodHex } from "../schema/zod-optionals";
import { RpcStorageSnapshot } from "./storage/rpc-storage-snapshot";
import { StringStorageVisitor } from "./reports/string-storage-visitor";
import { MAIN_CONTRACT_FIELDS } from "./storage/storage-props";
import {
  RpcSystemContractProvider,
  SystemContractList,
  type SystemContractProvider,
} from "./system-contract-providers";
import { z } from "zod";
import { RecordStorageSnapshot } from "./storage/record-storage-snapshot";
import { ListOfAddressesVisitor } from "./reports/list-of-addresses-visitor";
import { FacetsToSelectorsVisitor } from "./reports/facets-to-selectors-visitor";
import { AddressExtractor, BigNumberExtractor, BlobExtractor } from "./reports/extractors";
import type { ContractField } from "./storage/contractField";
import type { StorageSnapshot } from "./storage/storage-snapshot";
import type { StorageVisitor } from "./reports/storage-visitor";
import { l2UpgradeSchema, upgradeCallDataSchema } from "../schema/rpc";

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
  "baseTokenBridgeAddress",
] as const;

export const BYTES32_ZKSYNC_FIELDS = [
  "l2DefaultAccountBytecodeHash",
  "l2BootloaderBytecodeHash",
] as const;

export const HEX_ZKSYNC_FIELDS = [...ADDR_ZKSYNC_FIELDS, ...BYTES32_ZKSYNC_FIELDS] as const;

export type HexEraPropName = (typeof HEX_ZKSYNC_FIELDS)[number];

export const NUMERIC_ZKSYNC_FIELDS = [
  "baseTokenGasPriceMultiplierNominator",
  "baseTokenGasPriceMultiplierDenominator",
  "chainId",
  "protocolVersion",
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
    const bytes = Buffer.from(numberToBytes(this.data.protocolVersion, { size: 32 }));

    const subarray = bytes.subarray(0, 28);
    if (bytesToBigInt(subarray) === 0n) {
      return this.data.protocolVersion.toString();
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
      protocolVersion: await diamond.contractRead(rpc, "getProtocolVersion", z.bigint()),
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
    sender: Hex,
    targetAddr: Hex,
    callDataBuf: Buffer,
    network: Network,
    l1Explorer: BlockExplorerClient,
    rpc: RpcClient,
    l2Explorer: BlockExplorer
  ): Promise<[ZksyncEraState, Hex[]]> {
    const addr = DIAMOND_ADDRS[network];

    const memoryMap = await rpc.debugCallTraceStorage(sender, targetAddr, bytesToHex(callDataBuf));

    const post = Option.fromNullable(memoryMap.result.post[addr])
      .map((post) => post.storage)
      .flatten();

    const base = new RpcStorageSnapshot(rpc, addr);
    const storageWithUpgrade = base.apply(new RecordStorageSnapshot(post.unwrapOr({})));

    const facetsAddresses = await extractValue(
      MAIN_CONTRACT_FIELDS.facetAddresses,
      storageWithUpgrade,
      new ListOfAddressesVisitor()
    );
    const extractedFacetToSelectors = await extractValue(
      MAIN_CONTRACT_FIELDS.facetToSelectors(facetsAddresses),
      storageWithUpgrade,
      new FacetsToSelectorsVisitor()
    );
    const facetToSelectors = extractedFacetToSelectors as Map<Hex, Hex[]>;

    const facets = await Promise.all(
      facetsAddresses.map(async (addr) => getFacetData(addr, l1Explorer, facetToSelectors))
    );

    const systemContracts: L2ContractData[] = await getSystemContracts(
      rpc,
      sender,
      addr,
      bytesToHex(callDataBuf),
      l1Explorer,
      l2Explorer
    );
    await extractValue(
      MAIN_CONTRACT_FIELDS.verifierAddress,
      storageWithUpgrade,
      new AddressExtractor()
    );

    const state = new ZksyncEraState(
      {
        protocolVersion: await extractValue(
          MAIN_CONTRACT_FIELDS.protocolVersion,
          storageWithUpgrade,
          new BigNumberExtractor()
        ),
        verifierAddress: await extractValue(
          MAIN_CONTRACT_FIELDS.verifierAddress,
          storageWithUpgrade,
          new AddressExtractor()
        ),
        l2DefaultAccountBytecodeHash: await extractValue(
          MAIN_CONTRACT_FIELDS.l2DefaultAccountBytecodeHash,
          storageWithUpgrade,
          new BlobExtractor()
        ),
        l2BootloaderBytecodeHash: await extractValue(
          MAIN_CONTRACT_FIELDS.l2BootloaderBytecodeHash,
          storageWithUpgrade,
          new BlobExtractor()
        ),
        chainId: await extractValue(
          MAIN_CONTRACT_FIELDS.chainId,
          storageWithUpgrade,
          new BigNumberExtractor()
        ),
        bridgeHubAddress: await extractValue(
          MAIN_CONTRACT_FIELDS.bridgehubAddress,
          storageWithUpgrade,
          new AddressExtractor()
        ),
        stateTransitionManagerAddress: await extractValue(
          MAIN_CONTRACT_FIELDS.stateTransitionManager,
          storageWithUpgrade,
          new AddressExtractor()
        ),
        baseTokenBridgeAddress: await extractValue(
          MAIN_CONTRACT_FIELDS.baseTokenBridgeAddress,
          storageWithUpgrade,
          new AddressExtractor()
        ),
        admin: await extractValue(
          MAIN_CONTRACT_FIELDS.adminAddress,
          storageWithUpgrade,
          new AddressExtractor()
        ),
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

async function extractValue<T>(
  field: ContractField,
  snapshot: StorageSnapshot,
  visitor: StorageVisitor<T>
) {
  const value = await field.extract(snapshot);
  const maybeRes = value.map((v) => v.accept(visitor));
  return maybeRes.expect(new Error(`"${field.name}" should be present`));
}

async function getFacetData(
  address: Hex,
  explorer: BlockExplorer,
  selectorMap: Map<Hex, Hex[]>
): Promise<FacetData> {
  const contract = await explorer.getSourceCode(address);
  const selectors = selectorMap.get(address);
  if (!selectors) {
    throw new Error("selectors should be present");
  }
  return {
    name: contract.name,
    address,
    selectors,
  };
}

function findCall(calls: CallsTrace, selector: Hex): Option<CallsTrace> {
  if (calls.input.startsWith(selector)) {
    return Option.Some(calls);
  }

  if (!calls.calls) return Option.None();

  return calls.calls.reduce(
    (partial, nextCall) => partial.or(findCall(nextCall, selector)),
    Option.None<CallsTrace>()
  );
}

async function getSystemContracts(
  rpc: RpcClient,
  from: Hex,
  to: Hex,
  callData: Hex,
  l1Explorer: BlockExplorer,
  l2Explorer: BlockExplorer
): Promise<L2ContractData[]> {
  const calls = await rpc.debugCallTraceCalls(from, to, callData);

  const desiredCall = findCall(calls, UPGRADE_FN_SELECTOR);
  if (desiredCall.isNone()) {
    return [];
  }
  const { input: upgradeCalldata, to: upgradeAddr } = desiredCall.unwrap();

  const upgradeAbi = await l1Explorer.getAbi(upgradeAddr);
  const decodedUpgrade = upgradeAbi.decodeCallData(upgradeCalldata, upgradeCallDataSchema);

  const hex = decodedUpgrade.args[0].l2ProtocolUpgradeTx.to.toString(16);
  const deployAddr = `0x${"0".repeat(40 - hex.length)}${hex}`;
  const deploySysContractsAbi = await l2Explorer.getAbi(deployAddr);
  const decodedL2 = deploySysContractsAbi.decodeCallData(
    decodedUpgrade.args[0].l2ProtocolUpgradeTx.data,
    l2UpgradeSchema
  );

  return decodedL2.args[0].map((contract) => {
    const name = Option.fromNullable(
      SYSTEM_CONTRACT_NAMES[contract.newAddress.toLowerCase() as Hex]
    );
    return {
      name: name.unwrapOr("New contract."),
      address: contract.newAddress,
      bytecodeHash: contract.bytecodeHash,
    };
  });
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
