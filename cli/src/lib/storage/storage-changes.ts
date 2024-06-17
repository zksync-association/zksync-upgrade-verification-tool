import type { MemoryDiffRaw } from "../../schema/rpc";
import { Option } from "nochoices";
import { type Hex, hexToBigInt, hexToBytes } from "viem";
import { AddressType } from "./types/address-type";
import { BlobType } from "./types/blob-type";
import { MappingType } from "./mapping-type";
import { StructType } from "./types/struct-type";
import { BigNumberType } from "./types/big-number-type";
import { Property } from "./property";
import { FileStorageSnapshot, type StorageSnapshot } from "./storage-snapshot";
import { PropertyChange } from "./property-change";
import { BooleanType } from "./types/boolean-type";
import { FixedArrayType } from "./types/fixed-array-type";
import { ArrayType } from "./types/array-type";

const DIAMOND_STORAGE_SLOT = hexToBigInt(
  "0xc8fcad8db84d3cc18b4c41d551ea0ee66dd599cde068d998e57d5e09332c131b"
);

export class StorageChanges {
  pre: StorageSnapshot;
  post: StorageSnapshot;
  private selectors: Hex[];
  private contractProps: Property[];
  private facets: Hex[];

  constructor(
    diff: MemoryDiffRaw,
    addr: string,
    selectors: Hex[],
    facets: Hex[] = [],
    contractProps: Property[] = []
  ) {
    const pre = diff.result.pre[addr];
    const post = diff.result.post[addr];

    if (!pre) {
      throw new Error("missing pre");
    }

    if (!post) {
      throw new Error("missing post");
    }

    const preStorage = pre.storage.unwrapOr({});
    const postStorage = post.storage.unwrapOr({});

    this.pre = new FileStorageSnapshot(preStorage);
    this.post = new FileStorageSnapshot(postStorage);
    this.selectors = selectors;
    this.facets = facets;
    this.contractProps = contractProps.length === 0 ? this.allContractProps() : contractProps;
  }

  changeFor(propName: string): Option<PropertyChange> {
    const maybe = Option.fromNullable(this.contractProps.find((p) => p.name === propName));
    return maybe.map(
      (prop) => new PropertyChange(prop, prop.extract(this.pre), prop.extract(this.post))
    );
  }

  allChanges(): PropertyChange[] {
    return this.allContractProps()
      .map((prop) => {
        return new PropertyChange(prop, prop.extract(this.pre), prop.extract(this.post));
      })
      .filter((change) => change.before.isSome() || change.after.isSome());
  }

  private allContractProps(): Property[] {
    return [
      new Property(
        "ZkSyncHyperchainBase.s.__DEPRECATED_diamondCutStorage",
        0n,
        "[DEPRECATED] Storage of variables needed for deprecated diamond cut facet",
        new FixedArrayType(7, new AddressType())
      ),
      new Property(
        "ZkSyncHyperchainBase.s.__DEPRECATED_governor",
        7n,
        "Address which will exercise critical changes to the Diamond Proxy (upgrades, freezing & unfreezing)",
        new AddressType()
      ),
      new Property(
        "ZkSyncHyperchainBase.s.__DEPRECATED_pendingGovernor",
        8n,
        "Address that the governor proposed as one that will replace it",
        new AddressType()
      ),
      new Property(
        "ZkSyncHyperchainBase.s.validators",
        9n,
        "List of permitted validators",
        new MappingType([], new BooleanType())
      ),
      new Property(
        "ZkSyncHyperchainBase.s.verifier",
        10n,
        "Verifier contract. Used to verify aggregated proof for batches",
        new AddressType()
      ),
      new Property(
        "ZkSyncHyperchainBase.s.totalBatchesExecuted",
        11n,
        "Total number of executed batches i.e. batches[totalBatchesExecuted] points at the latest executed batch (batch 0 is genesis)",
        new BigNumberType()
      ),
      new Property(
        "ZkSyncHyperchainBase.s.totalBatchesVerified",
        12n,
        "Total number of proved batches i.e. batches[totalBatchesProved] points at the latest proved batch",
        new BigNumberType()
      ),
      new Property(
        "ZkSyncHyperchainBase.s.totalBatchesCommitted",
        13n,
        "Total number of committed batches i.e. batches[totalBatchesCommitted] points at the latest committed batch",
        new BigNumberType()
      ),
      new Property(
        "ZkSyncHyperchainBase.s.storedBatchHashes",
        14n,
        "Stored hashed StoredBatch for batch number",
        new MappingType([], new BigNumberType())
      ),
      new Property(
        "ZkSyncHyperchainBase.s.l2LogsRootHashes",
        15n,
        "Stored root hashes of L2 -> L1 logs",
        new MappingType([], new BigNumberType())
      ),
      new Property(
        "ZkSyncHyperchainBase.s.priorityQueue",
        15n,
        "Container that stores transactions requested from L1",
        new StructType([
          {
            name: "data",
            type: new MappingType(
              [],
              new StructType([
                {
                  name: "canonicalTxHash",
                  type: new BlobType(),
                },
                {
                  name: "expirationTimestamp",
                  type: new BigNumberType(8),
                },
                {
                  name: "layer2Tip",
                  type: new BigNumberType(24),
                },
              ])
            ),
          },
          {
            name: "tail",
            type: new BigNumberType(8),
          },
          {
            name: "head",
            type: new BigNumberType(24),
          },
        ])
      ),
      new Property(
        "ZkSyncHyperchainBase.s.__DEPRECATED_allowList",
        19n,
        "The smart contract that manages the list with permission to call contract functions",
        new AddressType()
      ),
      new Property(
        "ZkSyncHyperchainBase.s.__DEPRECATED_verifierParams",
        20n,
        "[DEPRECATED]",
        new StructType([
          {
            name: "recursionNodeLevelVkHash",
            type: new BlobType(),
          },
          {
            name: "recursionLeafLevelVkHash",
            type: new BlobType(),
          },
          {
            name: "recursionCircuitsSetVksHash",
            type: new BlobType(),
          },
        ])
      ),
      new Property(
        "ZkSyncHyperchainBase.s.l2BootloaderBytecodeHash",
        23n,
        "Bytecode hash of bootloader program. Used as an input to zkp-circuit.",
        new BlobType()
      ),
      new Property(
        "ZkSyncHyperchainBase.s.l2DefaultAccountBytecodeHash",
        24n,
        "Bytecode hash of default account (bytecode for EOA). Used as an input to zkp-circuit.",
        new BlobType()
      ),
      new Property(
        "ZkSyncHyperchainBase.s.zkPorterIsAvailable",
        25n,
        "Indicates that the porter may be touched on L2 transactions. " +
          "Used as an input to zkp-circuit.",
        new BooleanType()
      ),
      new Property(
        "ZkSyncHyperchainBase.s.priorityTxMaxGasLimit",
        26n,
        "The maximum number of the L2 gas that a user can request for L1 -> L2 transactions " +
          'This is the maximum number of L2 gas that is available for the "body" of the transaction, i.e. ' +
          "without overhead for proving the batch.",
        new BigNumberType()
      ),
      new Property(
        "ZkSyncHyperchainBase.s.__DEPRECATED_upgrades",
        27n,
        "[DEPRECATED] Storage of variables needed for upgrade facet",
        new BlobType()
      ),
      new Property(
        "ZkSyncHyperchainBase.s.isEthWithdrawalFinalized",
        29n,
        "A mapping L2 batch number => message number => flag. " +
          "The L2 -> L1 log is sent for every withdrawal, so this mapping is serving as " +
          "a flag to indicate that the message was already processed. " +
          "Used to indicate that eth withdrawal was already processed",
        new MappingType([], new MappingType([], new BooleanType()))
      ),
      new Property(
        "ZkSyncHyperchainBase.s.__DEPRECATED_lastWithdrawalLimitReset",
        30n,
        "The most recent withdrawal time and amount reset",
        new BigNumberType()
      ),
      new Property(
        "ZkSyncHyperchainBase.s.__DEPRECATED_withdrawnAmountInWindow",
        31n,
        "The accumulated withdrawn amount during the withdrawal limit window",
        new BigNumberType()
      ),
      new Property(
        "ZkSyncHyperchainBase.s.__DEPRECATED_totalDepositedAmountPerUser",
        32n,
        "[DEPRECATED] A mapping user address => the total deposited amount by the user",
        new MappingType([], new BigNumberType())
      ),
      new Property(
        "ZkSyncHyperchainBase.s.protocolVersion",
        33n,
        "Stores the protocol version. Note, that the protocol version may not only encompass changes to the smart contracts, but also to the node behavior.",
        new BigNumberType()
      ),
      new Property(
        "ZkSyncHyperchainBase.s.l2SystemContractsUpgradeTxHash",
        34n,
        "Hash of the system contract upgrade transaction. If 0, then no upgrade transaction needs to be done.",
        new BlobType()
      ),
      new Property(
        "ZkSyncHyperchainBase.s.l2SystemContractsUpgradeBatchNumber",
        35n,
        "Batch number where the upgrade transaction has happened. If 0, then no upgrade " +
          "yet transaction has happened",
        new BlobType()
      ),
      new Property(
        "ZkSyncHyperchainBase.s.admin",
        36n,
        "Address which will exercise non-critical changes to the Diamond Proxy (changing validator set & unfreezing)",
        new AddressType()
      ),
      new Property(
        "ZkSyncHyperchainBase.s.pendingAdmin",
        37n,
        "Address that the governor or admin proposed as one that will replace admin role",
        new AddressType()
      ),
      new Property(
        "ZkSyncHyperchainBase.s.feeParams",
        38n,
        "Fee params used to derive gasPrice for the L1->L2 transactions. For L2 transactions, " +
          "the bootloader gives enough freedom to the operator.",
        new StructType([
          {
            name: "pubdataPricingMode",
            type: new BigNumberType(1),
          },
          {
            name: "batchOverheadL1Gas",
            type: new BigNumberType(4),
          },
          {
            name: "maxPubdataPerBatch",
            type: new BigNumberType(4),
          },
          {
            name: "maxL2GasPerBatch",
            type: new BigNumberType(4),
          },
          {
            name: "priorityTxMaxPubdata",
            type: new BigNumberType(4),
          },
          {
            name: "minimalL2GasPrice",
            type: new BigNumberType(8),
          },
        ])
      ),
      new Property(
        "ZkSyncHyperchainBase.s.blobVersionedHashRetriever",
        39n,
        "Address of the blob versioned hash getter smart contract used for EIP-4844 versioned hashes.",
        new AddressType()
      ),
      new Property(
        "ZkSyncHyperchainBase.s.chainId",
        40n,
        "The chainId of the chain",
        new BigNumberType()
      ),
      new Property(
        "ZkSyncHyperchainBase.s.bridgehub",
        41n,
        "The address of the bridgehub",
        new AddressType()
      ),
      new Property(
        "ZkSyncHyperchainBase.s.stateTransitionManager",
        42n,
        "The address of the StateTransitionManager",
        new AddressType()
      ),
      new Property(
        "ZkSyncHyperchainBase.s.baseToken",
        43n,
        "The address of the baseToken contract. Eth is address(1)",
        new AddressType()
      ),
      new Property(
        "ZkSyncHyperchainBase.s.baseTokenBridge",
        44n,
        "The address of the baseTokenbridge. Eth also uses the shared bridge",
        new AddressType()
      ),
      new Property(
        "ZkSyncHyperchainBase.s.baseTokenGasPriceMultiplierNominator",
        45n,
        "The chainId of the chain",
        new BigNumberType(16)
      ),
      new Property(
        "ZkSyncHyperchainBase.s.baseTokenGasPriceMultiplierDenominator",
        45n,
        "The chainId of the chain",
        new BigNumberType(16),
        16
      ),
      new Property(
        "ZkSyncHyperchainBase.s.transactionFilterer",
        45n,
        "The address of the baseTokenbridge. Eth also uses the shared bridge",
        new AddressType()
      ),
      new Property(
        "DiamondStorage.selectorToFacet",
        DIAMOND_STORAGE_SLOT,
        "A mapping from the selector to the facet address and its meta information",
        new MappingType(
          this.selectors.map((sel) => {
            const as = hexToBytes(sel);
            return Buffer.from(as);
          }),
          new StructType([
            {
              name: "facetAddress",
              type: new AddressType(),
            },
            {
              name: "selectorPosition",
              type: new BigNumberType(2),
            },
            {
              name: "isFreezable",
              type: new BooleanType(),
            },
          ]),
          false
        )
      ),
      new Property(
        "DiamondStorage.facetToSelectors",
        DIAMOND_STORAGE_SLOT + 1n,
        "The array of all unique facet addresses that belong to the diamond proxy",
        new MappingType(
          this.facets.map((s) => hexToBytes(s)).map(Buffer.from),
          new StructType([
            {
              name: "selectors",
              type: new ArrayType(new BlobType(4)),
            },
            {
              name: "facetPosition",
              type: new BigNumberType(2),
            },
          ]),
          true
        )
      ),
      new Property(
        "DiamondStorage.facets",
        DIAMOND_STORAGE_SLOT + 2n,
        "The array of all unique facet addresses that belong to the diamond proxy",
        new ArrayType(new AddressType())
      ),
    ];
  }
}
