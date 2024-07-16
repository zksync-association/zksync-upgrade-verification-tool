import { ContractField } from "./contractField";
import { FixedArrayType } from "./types/fixed-array-type";
import { AddressType } from "./types/address-type";
import { MappingType } from "./mapping-type";
import { BooleanType } from "./types/boolean-type";
import { BigNumberType } from "./types/big-number-type";
import { StructType } from "./types/struct-type";
import { BlobType } from "./types/blob-type";
import { type Hex, hexToBytes } from "viem";
import { ArrayType } from "./types/array-type";
import { DIAMOND_STORAGE_SLOT } from "./storage-changes";

export const MAIN_CONTRACT_FIELDS = {
  protocolVersion: new ContractField(
    "ZkSyncHyperchainBase.s.protocolVersion",
    33n,
    "Stores the protocol version. Note, that the protocol version may not only encompass changes to the smart contracts, but also to the node behavior.",
    new BigNumberType()
  ),
  verifierAddress: new ContractField(
    "ZkSyncHyperchainBase.s.verifier",
    10n,
    "Verifier contract. Used to verify aggregated proof for batches",
    new AddressType()
  ),
  l2BootloaderBytecodeHash: new ContractField(
    "ZkSyncHyperchainBase.s.l2BootloaderBytecodeHash",
    23n,
    "Bytecode hash of bootloader program. Used as an input to zkp-circuit.",
    new BlobType()
  ),
  l2DefaultAccountBytecodeHash: new ContractField(
    "ZkSyncHyperchainBase.s.l2DefaultAccountBytecodeHash",
    24n,
    "Bytecode hash of default account (bytecode for EOA). Used as an input to zkp-circuit.",
    new BlobType()
  ),
  adminAddress: new ContractField(
    "ZkSyncHyperchainBase.s.admin",
    36n,
    "Address which will exercise non-critical changes to the Diamond Proxy (changing validator set & unfreezing)",
    new AddressType()
  ),
  blobVersionedHashRetriever: new ContractField(
    "ZkSyncHyperchainBase.s.blobVersionedHashRetriever",
    39n,
    "Address of the blob versioned hash getter smart contract used for EIP-4844 versioned hashes.",
    new AddressType()
  ),
  chainId: new ContractField(
    "ZkSyncHyperchainBase.s.chainId",
    40n,
    "The chainId of the chain",
    new BigNumberType()
  ),
  bridgehubAddress: new ContractField(
    "ZkSyncHyperchainBase.s.bridgehub",
    41n,
    "The address of the bridgehub",
    new AddressType()
  ),
  stateTransitionManager: new ContractField(
    "ZkSyncHyperchainBase.s.stateTransitionManager",
    42n,
    "The address of the StateTransitionManager",
    new AddressType()
  ),
  baseTokenBridgeAddress: new ContractField(
    "ZkSyncHyperchainBase.s.baseTokenBridge",
    44n,
    "The address of the baseTokenbridge. Eth also uses the shared bridge",
    new AddressType()
  ),
  baseTokenGasPriceMultiplierNominator: new ContractField(
    "ZkSyncHyperchainBase.s.baseTokenGasPriceMultiplierNominator",
    45n,
    "The chainId of the chain",
    new BigNumberType(16)
  ),
  baseTokenGasPriceMultiplierDenominator: new ContractField(
    "ZkSyncHyperchainBase.s.baseTokenGasPriceMultiplierDenominator",
    45n,
    "The chainId of the chain",
    new BigNumberType(16),
    16
  ),
  facetAddresses: new ContractField(
    "DiamondStorage.facets",
    DIAMOND_STORAGE_SLOT + 2n,
    "The array of all unique facet addresses that belong to the diamond proxy",
    new ArrayType(new AddressType())
  ),
  facetToSelectors: (facets: Hex[]) =>
    new ContractField(
      "DiamondStorage.facetToSelectors",
      DIAMOND_STORAGE_SLOT + 1n,
      "The array of all unique facet addresses that belong to the diamond proxy",
      new MappingType(
        facets.map((s) => hexToBytes(s)).map(Buffer.from),
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
};

export function mainDiamondFields(selectors: Hex[], facets: Hex[]): ContractField[] {
  return [
    new ContractField(
      "ZkSyncHyperchainBase.s.__DEPRECATED_diamondCutStorage",
      0n,
      "[DEPRECATED] Storage of variables needed for deprecated diamond cut facet",
      new FixedArrayType(7, new AddressType())
    ),
    new ContractField(
      "ZkSyncHyperchainBase.s.__DEPRECATED_governor",
      7n,
      "Address which will exercise critical changes to the Diamond Proxy (upgrades, freezing & unfreezing)",
      new AddressType()
    ),
    new ContractField(
      "ZkSyncHyperchainBase.s.__DEPRECATED_pendingGovernor",
      8n,
      "Address that the governor proposed as one that will replace it",
      new AddressType()
    ),
    new ContractField(
      "ZkSyncHyperchainBase.s.validators",
      9n,
      "List of permitted validators",
      new MappingType([], new BooleanType())
    ),
    MAIN_CONTRACT_FIELDS.verifierAddress,
    new ContractField(
      "ZkSyncHyperchainBase.s.totalBatchesExecuted",
      11n,
      "Total number of executed batches i.e. batches[totalBatchesExecuted] points at the latest executed batch (batch 0 is genesis)",
      new BigNumberType()
    ),
    new ContractField(
      "ZkSyncHyperchainBase.s.totalBatchesVerified",
      12n,
      "Total number of proved batches i.e. batches[totalBatchesProved] points at the latest proved batch",
      new BigNumberType()
    ),
    new ContractField(
      "ZkSyncHyperchainBase.s.totalBatchesCommitted",
      13n,
      "Total number of committed batches i.e. batches[totalBatchesCommitted] points at the latest committed batch",
      new BigNumberType()
    ),
    new ContractField(
      "ZkSyncHyperchainBase.s.storedBatchHashes",
      14n,
      "Stored hashed StoredBatch for batch number",
      new MappingType([], new BigNumberType())
    ),
    new ContractField(
      "ZkSyncHyperchainBase.s.l2LogsRootHashes",
      15n,
      "Stored root hashes of L2 -> L1 logs",
      new MappingType([], new BigNumberType())
    ),
    new ContractField(
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
    new ContractField(
      "ZkSyncHyperchainBase.s.__DEPRECATED_allowList",
      19n,
      "The smart contract that manages the list with permission to call contract functions",
      new AddressType()
    ),
    new ContractField(
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
    MAIN_CONTRACT_FIELDS.l2BootloaderBytecodeHash,
    MAIN_CONTRACT_FIELDS.l2DefaultAccountBytecodeHash,
    new ContractField(
      "ZkSyncHyperchainBase.s.zkPorterIsAvailable",
      25n,
      "Indicates that the porter may be touched on L2 transactions. " +
        "Used as an input to zkp-circuit.",
      new BooleanType()
    ),
    new ContractField(
      "ZkSyncHyperchainBase.s.priorityTxMaxGasLimit",
      26n,
      "The maximum number of the L2 gas that a user can request for L1 -> L2 transactions " +
        'This is the maximum number of L2 gas that is available for the "body" of the transaction, i.e. ' +
        "without overhead for proving the batch.",
      new BigNumberType()
    ),
    new ContractField(
      "ZkSyncHyperchainBase.s.__DEPRECATED_upgrades",
      27n,
      "[DEPRECATED] Storage of variables needed for upgrade facet",
      new BlobType()
    ),
    new ContractField(
      "ZkSyncHyperchainBase.s.isEthWithdrawalFinalized",
      29n,
      "A mapping L2 batch number => message number => flag. " +
        "The L2 -> L1 log is sent for every withdrawal, so this mapping is serving as " +
        "a flag to indicate that the message was already processed. " +
        "Used to indicate that eth withdrawal was already processed",
      new MappingType([], new MappingType([], new BooleanType()))
    ),
    new ContractField(
      "ZkSyncHyperchainBase.s.__DEPRECATED_lastWithdrawalLimitReset",
      30n,
      "The most recent withdrawal time and amount reset",
      new BigNumberType()
    ),
    new ContractField(
      "ZkSyncHyperchainBase.s.__DEPRECATED_withdrawnAmountInWindow",
      31n,
      "The accumulated withdrawn amount during the withdrawal limit window",
      new BigNumberType()
    ),
    new ContractField(
      "ZkSyncHyperchainBase.s.__DEPRECATED_totalDepositedAmountPerUser",
      32n,
      "[DEPRECATED] A mapping user address => the total deposited amount by the user",
      new MappingType([], new BigNumberType())
    ),
    MAIN_CONTRACT_FIELDS.protocolVersion,
    new ContractField(
      "ZkSyncHyperchainBase.s.l2SystemContractsUpgradeTxHash",
      34n,
      "Hash of the system contract upgrade transaction. If 0, then no upgrade transaction needs to be done.",
      new BlobType()
    ),
    new ContractField(
      "ZkSyncHyperchainBase.s.l2SystemContractsUpgradeBatchNumber",
      35n,
      "Batch number where the upgrade transaction has happened. If 0, then no upgrade " +
        "yet transaction has happened",
      new BlobType()
    ),
    MAIN_CONTRACT_FIELDS.adminAddress,
    new ContractField(
      "ZkSyncHyperchainBase.s.pendingAdmin",
      37n,
      "Address that the governor or admin proposed as one that will replace admin role",
      new AddressType()
    ),
    new ContractField(
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
    MAIN_CONTRACT_FIELDS.blobVersionedHashRetriever,
    MAIN_CONTRACT_FIELDS.chainId,
    MAIN_CONTRACT_FIELDS.bridgehubAddress,
    new ContractField(
      "ZkSyncHyperchainBase.s.stateTransitionManager",
      42n,
      "The address of the StateTransitionManager",
      new AddressType()
    ),
    new ContractField(
      "ZkSyncHyperchainBase.s.baseToken",
      43n,
      "The address of the baseToken contract. Eth is address(1)",
      new AddressType()
    ),
    MAIN_CONTRACT_FIELDS.baseTokenBridgeAddress,
    MAIN_CONTRACT_FIELDS.baseTokenGasPriceMultiplierNominator,
    MAIN_CONTRACT_FIELDS.baseTokenGasPriceMultiplierDenominator,
    new ContractField(
      "ZkSyncHyperchainBase.s.transactionFilterer",
      45n,
      "The address of the baseTokenbridge. Eth also uses the shared bridge",
      new AddressType()
    ),
    new ContractField(
      "DiamondStorage.selectorToFacet",
      DIAMOND_STORAGE_SLOT,
      "A mapping from the selector to the facet address and its meta information",
      new MappingType(
        selectors.map((sel) => {
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
    MAIN_CONTRACT_FIELDS.facetToSelectors(facets),
    MAIN_CONTRACT_FIELDS.facetAddresses,
  ];
}
