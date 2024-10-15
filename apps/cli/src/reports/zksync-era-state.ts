import { bytesToBigInt, bytesToNumber, type Hex, numberToBytes, numberToHex, } from "viem";
import type { FacetData } from "./upgrade-changes.js";
import { Option } from "nochoices";
import { Diamond } from "./diamond.js";
import { RpcStorageSnapshot } from "./storage/snapshot";
import { StringStorageVisitor } from "./reports/string-storage-visitor.js";
import { MAIN_CONTRACT_FIELDS } from "./storage/storage-props.js";
import { SystemContractList, type SystemContractProvider, } from "./system-contract-providers.js";
import { z } from "zod";
import { DIAMOND_ADDRS, type Network, UPGRADE_FN_SELECTOR } from "@repo/common/ethereum";
import { hexSchema } from "@repo/common/schemas";
import { BlockExplorerClient } from "../ethereum/block-explorer-client";
import { MissingRequiredProp } from "../lib/errors";
import { RpcClient } from "../ethereum/rpc-client";
import type { RawCall } from "../lib/upgrade-file";
import { LocalFork } from "./local-fork";

const baseCallTracerSchema = z.object({
  from: z.string(),
  to: z.string(),
  input: z.string(),
});

export type CallTrace = z.infer<typeof baseCallTracerSchema> & {
  calls?: CallTrace[];
};

export const callTracerSchema: z.ZodType<CallTrace> = baseCallTracerSchema.extend({
  calls: z.lazy(() => callTracerSchema.array().optional()),
});

export const l2UpgradeSchema = z.object({
  functionName: z.string(),
  args: z.tuple([
    z.array(
      z.object({
        bytecodeHash: hexSchema,
        newAddress: hexSchema,
        callConstructor: z.boolean(),
        value: z.bigint(),
        input: z.string(),
      })
    ),
  ]),
});

export const upgradeCallDataSchema = z.object({
  functionName: z.string(),
  args: z.tuple([
    z.object({
      l2ProtocolUpgradeTx: z.object({
        to: z.bigint(),
        from: z.bigint(),
        data: hexSchema,
      }),
      factoryDeps: z.array(z.any()),
      bootloaderHash: hexSchema,
      defaultAccountHash: hexSchema,
      verifier: hexSchema,
      verifierParams: z.any(),
      l1ContractsUpgradeCalldata: z.string(),
      postUpgradeCalldata: hexSchema,
      upgradeTimestamp: z.bigint(),
      newProtocolVersion: z.bigint(),
    }),
  ]),
});

export type L2ContractData = {
  address: Hex;
  bytecodeHash: Hex;
  name: string;
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
  affectedSystemContracts: L2ContractData[];

  constructor(
    data: ZkEraStateData,
    facets: FacetData[],
    systemContracts: SystemContractProvider,
    affectedSystemContracts: L2ContractData[]
  ) {
    this.data = data;
    this.facets = facets;
    this.systemContracts = systemContracts;
    this.affectedSystemContracts = affectedSystemContracts;
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
    rpc: RpcClient,
    explorer: BlockExplorerClient,
    systemContracts: SystemContractProvider,
    affectedSystemContracts: L2ContractData[] = []
  ): Promise<ZksyncEraState> {
    const diamond = new Diamond(DIAMOND_ADDRS[network]);
    await diamond.init(explorer, rpc)
    const facets = diamond.allFacets();

    const memorySnapshot = new RpcStorageSnapshot(rpc, diamond.address);
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
      admin: await diamond.contractRead(rpc, "getAdmin", hexSchema),
      pendingAdmin: await diamond.contractRead(rpc, "getPendingAdmin", hexSchema),
      verifierAddress: await diamond.contractRead(rpc, "getVerifier", hexSchema),
      bridgeHubAddress: await diamond.contractRead(rpc, "getBridgehub", hexSchema),
      protocolVersion: await diamond.contractRead(rpc, "getProtocolVersion", z.bigint()),
      baseTokenBridgeAddress: await diamond.contractRead(rpc, "getBaseTokenBridge", hexSchema),
      stateTransitionManagerAddress: await diamond.contractRead(
        rpc,
        "getStateTransitionManager",
        hexSchema
      ),
      l2DefaultAccountBytecodeHash: await diamond.contractRead(
        rpc,
        "getL2DefaultAccountBytecodeHash",
        hexSchema
      ),
      l2BootloaderBytecodeHash: await diamond.contractRead(
        rpc,
        "getL2BootloaderBytecodeHash",
        hexSchema
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
      systemContracts,
      affectedSystemContracts
    );
  }

  allSelectors(): Hex[] {
    return this.facets.reduce((a, b) => a.concat(b.selectors), new Array<Hex>());
  }

  async applyTxs(
    l1Explorer: BlockExplorerClient,
    l2Explorer: BlockExplorerClient,
    l1Rpc: RpcClient,
    network: Network,
    calls: RawCall[]
  ): Promise<ZksyncEraState> {
    const localFork = await LocalFork.create(l1Rpc.rpcUrl(), network);
    const diamond = new Diamond(DIAMOND_ADDRS[network]);
    await diamond.init(l1Explorer, l1Rpc);

    const transitionManager = await diamond.getTransitionManager(l1Rpc, l1Explorer);
    const protocolHandlerAddress = await transitionManager.upgradeHandlerAddress(l1Rpc);

    const systemContracts = [];

    for (const call of calls) {
      const [_, debugInfo] = await localFork.execDebugTx(
        protocolHandlerAddress,
        call.target,
        call.data,
        call.value
      );
      const execUpgradeCall = debugInfo.find((di) => di.input.startsWith(UPGRADE_FN_SELECTOR));
      if (
        execUpgradeCall === undefined ||
        execUpgradeCall.to === undefined ||
        execUpgradeCall.input === undefined
      ) {
        continue;
      }

      const abi = await l1Explorer.getAbi(execUpgradeCall.to);
      const decoded = abi.decodeCallData(execUpgradeCall.input, upgradeCallDataSchema);
      const l2Target = numberToHex(decoded.args[0].l2ProtocolUpgradeTx.to, { size: 20 });
      const l2Abi = await l2Explorer.getAbi(l2Target);
      const l2Call = l2Abi.decodeCallData(
        decoded.args[0].l2ProtocolUpgradeTx.data,
        l2UpgradeSchema
      );
      const upgradedSystemContracts = l2Call.args[0].map(
        (a): L2ContractData => ({
          address: a.newAddress,
          name: SYSTEM_CONTRACT_NAMES[a.newAddress] || "Unknown Name",
          bytecodeHash: a.bytecodeHash,
        })
      );
      systemContracts.push(...upgradedSystemContracts);
    }

    await localFork.tearDown();
    return await ZksyncEraState.fromBlockchain(
      network,
      localFork.rpc(),
      l1Explorer,
      new SystemContractList(systemContracts),
      systemContracts
    );
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
