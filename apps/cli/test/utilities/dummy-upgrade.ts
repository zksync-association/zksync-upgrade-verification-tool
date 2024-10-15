import type { RpcClient } from "../../src/ethereum/rpc-client";
import {
  type Address,
  bytesToBigInt,
  encodeFunctionData,
  type Hex,
  hexToBigInt,
  numberToBytes,
  padHex,
  zeroAddress,
} from "viem";
import type { StateTransitionManager } from "../../src/reports/state-transition-manager";
import { hexSchema } from "@repo/common/schemas";

export const defaultUpgradeAbi = [
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "bytes32",
        name: "previousBytecodeHash",
        type: "bytes32",
      },
      { indexed: true, internalType: "bytes32", name: "newBytecodeHash", type: "bytes32" },
    ],
    name: "NewL2BootloaderBytecodeHash",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "bytes32",
        name: "previousBytecodeHash",
        type: "bytes32",
      },
      { indexed: true, internalType: "bytes32", name: "newBytecodeHash", type: "bytes32" },
    ],
    name: "NewL2DefaultAccountBytecodeHash",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "uint256",
        name: "previousProtocolVersion",
        type: "uint256",
      },
      { indexed: true, internalType: "uint256", name: "newProtocolVersion", type: "uint256" },
    ],
    name: "NewProtocolVersion",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "address", name: "oldVerifier", type: "address" },
      {
        indexed: true,
        internalType: "address",
        name: "newVerifier",
        type: "address",
      },
    ],
    name: "NewVerifier",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        components: [
          {
            internalType: "bytes32",
            name: "recursionNodeLevelVkHash",
            type: "bytes32",
          },
          { internalType: "bytes32", name: "recursionLeafLevelVkHash", type: "bytes32" },
          {
            internalType: "bytes32",
            name: "recursionCircuitsSetVksHash",
            type: "bytes32",
          },
        ],
        indexed: false,
        internalType: "struct VerifierParams",
        name: "oldVerifierParams",
        type: "tuple",
      },
      {
        components: [
          {
            internalType: "bytes32",
            name: "recursionNodeLevelVkHash",
            type: "bytes32",
          },
          { internalType: "bytes32", name: "recursionLeafLevelVkHash", type: "bytes32" },
          {
            internalType: "bytes32",
            name: "recursionCircuitsSetVksHash",
            type: "bytes32",
          },
        ],
        indexed: false,
        internalType: "struct VerifierParams",
        name: "newVerifierParams",
        type: "tuple",
      },
    ],
    name: "NewVerifierParams",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "uint256",
        name: "newProtocolVersion",
        type: "uint256",
      },
      { indexed: true, internalType: "bytes32", name: "l2UpgradeTxHash", type: "bytes32" },
      {
        components: [
          {
            components: [
              { internalType: "uint256", name: "txType", type: "uint256" },
              {
                internalType: "uint256",
                name: "from",
                type: "uint256",
              },
              { internalType: "uint256", name: "to", type: "uint256" },
              {
                internalType: "uint256",
                name: "gasLimit",
                type: "uint256",
              },
              { internalType: "uint256", name: "gasPerPubdataByteLimit", type: "uint256" },
              {
                internalType: "uint256",
                name: "maxFeePerGas",
                type: "uint256",
              },
              { internalType: "uint256", name: "maxPriorityFeePerGas", type: "uint256" },
              {
                internalType: "uint256",
                name: "paymaster",
                type: "uint256",
              },
              { internalType: "uint256", name: "nonce", type: "uint256" },
              {
                internalType: "uint256",
                name: "value",
                type: "uint256",
              },
              { internalType: "uint256[4]", name: "reserved", type: "uint256[4]" },
              {
                internalType: "bytes",
                name: "data",
                type: "bytes",
              },
              { internalType: "bytes", name: "signature", type: "bytes" },
              {
                internalType: "uint256[]",
                name: "factoryDeps",
                type: "uint256[]",
              },
              { internalType: "bytes", name: "paymasterInput", type: "bytes" },
              {
                internalType: "bytes",
                name: "reservedDynamic",
                type: "bytes",
              },
            ],
            internalType: "struct L2CanonicalTransaction",
            name: "l2ProtocolUpgradeTx",
            type: "tuple",
          },
          { internalType: "bytes[]", name: "factoryDeps", type: "bytes[]" },
          {
            internalType: "bytes32",
            name: "bootloaderHash",
            type: "bytes32",
          },
          { internalType: "bytes32", name: "defaultAccountHash", type: "bytes32" },
          {
            internalType: "address",
            name: "verifier",
            type: "address",
          },
          {
            components: [
              {
                internalType: "bytes32",
                name: "recursionNodeLevelVkHash",
                type: "bytes32",
              },
              { internalType: "bytes32", name: "recursionLeafLevelVkHash", type: "bytes32" },
              {
                internalType: "bytes32",
                name: "recursionCircuitsSetVksHash",
                type: "bytes32",
              },
            ],
            internalType: "struct VerifierParams",
            name: "verifierParams",
            type: "tuple",
          },
          { internalType: "bytes", name: "l1ContractsUpgradeCalldata", type: "bytes" },
          {
            internalType: "bytes",
            name: "postUpgradeCalldata",
            type: "bytes",
          },
          { internalType: "uint256", name: "upgradeTimestamp", type: "uint256" },
          {
            internalType: "uint256",
            name: "newProtocolVersion",
            type: "uint256",
          },
        ],
        indexed: false,
        internalType: "struct ProposedUpgrade",
        name: "upgrade",
        type: "tuple",
      },
    ],
    name: "UpgradeComplete",
    type: "event",
  },
  {
    inputs: [
      {
        components: [
          {
            components: [
              { internalType: "uint256", name: "txType", type: "uint256" },
              {
                internalType: "uint256",
                name: "from",
                type: "uint256",
              },
              { internalType: "uint256", name: "to", type: "uint256" },
              {
                internalType: "uint256",
                name: "gasLimit",
                type: "uint256",
              },
              { internalType: "uint256", name: "gasPerPubdataByteLimit", type: "uint256" },
              {
                internalType: "uint256",
                name: "maxFeePerGas",
                type: "uint256",
              },
              { internalType: "uint256", name: "maxPriorityFeePerGas", type: "uint256" },
              {
                internalType: "uint256",
                name: "paymaster",
                type: "uint256",
              },
              { internalType: "uint256", name: "nonce", type: "uint256" },
              {
                internalType: "uint256",
                name: "value",
                type: "uint256",
              },
              { internalType: "uint256[4]", name: "reserved", type: "uint256[4]" },
              {
                internalType: "bytes",
                name: "data",
                type: "bytes",
              },
              { internalType: "bytes", name: "signature", type: "bytes" },
              {
                internalType: "uint256[]",
                name: "factoryDeps",
                type: "uint256[]",
              },
              { internalType: "bytes", name: "paymasterInput", type: "bytes" },
              {
                internalType: "bytes",
                name: "reservedDynamic",
                type: "bytes",
              },
            ],
            internalType: "struct L2CanonicalTransaction",
            name: "l2ProtocolUpgradeTx",
            type: "tuple",
          },
          { internalType: "bytes[]", name: "factoryDeps", type: "bytes[]" },
          {
            internalType: "bytes32",
            name: "bootloaderHash",
            type: "bytes32",
          },
          { internalType: "bytes32", name: "defaultAccountHash", type: "bytes32" },
          {
            internalType: "address",
            name: "verifier",
            type: "address",
          },
          {
            components: [
              {
                internalType: "bytes32",
                name: "recursionNodeLevelVkHash",
                type: "bytes32",
              },
              { internalType: "bytes32", name: "recursionLeafLevelVkHash", type: "bytes32" },
              {
                internalType: "bytes32",
                name: "recursionCircuitsSetVksHash",
                type: "bytes32",
              },
            ],
            internalType: "struct VerifierParams",
            name: "verifierParams",
            type: "tuple",
          },
          { internalType: "bytes", name: "l1ContractsUpgradeCalldata", type: "bytes" },
          {
            internalType: "bytes",
            name: "postUpgradeCalldata",
            type: "bytes",
          },
          { internalType: "uint256", name: "upgradeTimestamp", type: "uint256" },
          {
            internalType: "uint256",
            name: "newProtocolVersion",
            type: "uint256",
          },
        ],
        internalType: "struct ProposedUpgrade",
        name: "_proposedUpgrade",
        type: "tuple",
      },
    ],
    name: "upgrade",
    outputs: [{ internalType: "bytes32", name: "", type: "bytes32" }],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;
export const stateTransitionManagerAbi = [
  {
    inputs: [
      {
        internalType: "address",
        name: "_bridgehub",
        type: "address",
      },
      { internalType: "uint256", name: "_maxNumberOfHyperchains", type: "uint256" },
    ],
    stateMutability: "nonpayable",
    type: "constructor",
  },
  {
    anonymous: false,
    inputs: [{ indexed: false, internalType: "uint8", name: "version", type: "uint8" }],
    name: "Initialized",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "address", name: "oldAdmin", type: "address" },
      {
        indexed: true,
        internalType: "address",
        name: "newAdmin",
        type: "address",
      },
    ],
    name: "NewAdmin",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "address",
        name: "genesisUpgrade",
        type: "address",
      },
      { indexed: false, internalType: "bytes32", name: "genesisBatchHash", type: "bytes32" },
      {
        indexed: false,
        internalType: "uint64",
        name: "genesisIndexRepeatedStorageChanges",
        type: "uint64",
      },
      {
        indexed: false,
        internalType: "bytes32",
        name: "genesisBatchCommitment",
        type: "bytes32",
      },
      { indexed: false, internalType: "bytes32", name: "newInitialCutHash", type: "bytes32" },
    ],
    name: "NewChainCreationParams",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "uint256", name: "_chainId", type: "uint256" },
      {
        indexed: true,
        internalType: "address",
        name: "_hyperchainContract",
        type: "address",
      },
    ],
    name: "NewHyperchain",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "oldPendingAdmin",
        type: "address",
      },
      { indexed: true, internalType: "address", name: "newPendingAdmin", type: "address" },
    ],
    name: "NewPendingAdmin",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "uint256",
        name: "oldProtocolVersion",
        type: "uint256",
      },
      { indexed: true, internalType: "uint256", name: "newProtocolVersion", type: "uint256" },
    ],
    name: "NewProtocolVersion",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "uint256",
        name: "protocolVersion",
        type: "uint256",
      },
      {
        components: [
          {
            components: [
              {
                internalType: "address",
                name: "facet",
                type: "address",
              },
              { internalType: "enum Diamond.Action", name: "action", type: "uint8" },
              {
                internalType: "bool",
                name: "isFreezable",
                type: "bool",
              },
              { internalType: "bytes4[]", name: "selectors", type: "bytes4[]" },
            ],
            internalType: "struct Diamond.FacetCut[]",
            name: "facetCuts",
            type: "tuple[]",
          },
          { internalType: "address", name: "initAddress", type: "address" },
          {
            internalType: "bytes",
            name: "initCalldata",
            type: "bytes",
          },
        ],
        indexed: false,
        internalType: "struct Diamond.DiamondCutData",
        name: "diamondCutData",
        type: "tuple",
      },
    ],
    name: "NewUpgradeCutData",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "uint256",
        name: "protocolVersion",
        type: "uint256",
      },
      { indexed: true, internalType: "bytes32", name: "upgradeCutHash", type: "bytes32" },
    ],
    name: "NewUpgradeCutHash",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "oldValidatorTimelock",
        type: "address",
      },
      { indexed: true, internalType: "address", name: "newValidatorTimelock", type: "address" },
    ],
    name: "NewValidatorTimelock",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "address", name: "previousOwner", type: "address" },
      {
        indexed: true,
        internalType: "address",
        name: "newOwner",
        type: "address",
      },
    ],
    name: "OwnershipTransferStarted",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "address", name: "previousOwner", type: "address" },
      {
        indexed: true,
        internalType: "address",
        name: "newOwner",
        type: "address",
      },
    ],
    name: "OwnershipTransferred",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "address", name: "_hyperchain", type: "address" },
      {
        components: [
          { internalType: "uint256", name: "txType", type: "uint256" },
          {
            internalType: "uint256",
            name: "from",
            type: "uint256",
          },
          { internalType: "uint256", name: "to", type: "uint256" },
          {
            internalType: "uint256",
            name: "gasLimit",
            type: "uint256",
          },
          { internalType: "uint256", name: "gasPerPubdataByteLimit", type: "uint256" },
          {
            internalType: "uint256",
            name: "maxFeePerGas",
            type: "uint256",
          },
          { internalType: "uint256", name: "maxPriorityFeePerGas", type: "uint256" },
          {
            internalType: "uint256",
            name: "paymaster",
            type: "uint256",
          },
          { internalType: "uint256", name: "nonce", type: "uint256" },
          {
            internalType: "uint256",
            name: "value",
            type: "uint256",
          },
          { internalType: "uint256[4]", name: "reserved", type: "uint256[4]" },
          {
            internalType: "bytes",
            name: "data",
            type: "bytes",
          },
          { internalType: "bytes", name: "signature", type: "bytes" },
          {
            internalType: "uint256[]",
            name: "factoryDeps",
            type: "uint256[]",
          },
          { internalType: "bytes", name: "paymasterInput", type: "bytes" },
          {
            internalType: "bytes",
            name: "reservedDynamic",
            type: "bytes",
          },
        ],
        indexed: false,
        internalType: "struct L2CanonicalTransaction",
        name: "_l2Transaction",
        type: "tuple",
      },
      { indexed: true, internalType: "uint256", name: "_protocolVersion", type: "uint256" },
    ],
    name: "SetChainIdUpgrade",
    type: "event",
  },
  {
    inputs: [],
    name: "BRIDGE_HUB",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "MAX_NUMBER_OF_HYPERCHAINS",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "acceptAdmin",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [],
    name: "acceptOwnership",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [],
    name: "admin",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "_chainId",
        type: "uint256",
      },
      {
        components: [
          {
            internalType: "enum PubdataPricingMode",
            name: "pubdataPricingMode",
            type: "uint8",
          },
          { internalType: "uint32", name: "batchOverheadL1Gas", type: "uint32" },
          {
            internalType: "uint32",
            name: "maxPubdataPerBatch",
            type: "uint32",
          },
          { internalType: "uint32", name: "maxL2GasPerBatch", type: "uint32" },
          {
            internalType: "uint32",
            name: "priorityTxMaxPubdata",
            type: "uint32",
          },
          { internalType: "uint64", name: "minimalL2GasPrice", type: "uint64" },
        ],
        internalType: "struct FeeParams",
        name: "_newFeeParams",
        type: "tuple",
      },
    ],
    name: "changeFeeParams",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { internalType: "uint256", name: "_chainId", type: "uint256" },
      {
        internalType: "address",
        name: "_baseToken",
        type: "address",
      },
      { internalType: "address", name: "_sharedBridge", type: "address" },
      {
        internalType: "address",
        name: "_admin",
        type: "address",
      },
      { internalType: "bytes", name: "_diamondCut", type: "bytes" },
    ],
    name: "createNewChain",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "_chainId",
        type: "uint256",
      },
      {
        components: [
          {
            components: [
              {
                internalType: "address",
                name: "facet",
                type: "address",
              },
              { internalType: "enum Diamond.Action", name: "action", type: "uint8" },
              {
                internalType: "bool",
                name: "isFreezable",
                type: "bool",
              },
              { internalType: "bytes4[]", name: "selectors", type: "bytes4[]" },
            ],
            internalType: "struct Diamond.FacetCut[]",
            name: "facetCuts",
            type: "tuple[]",
          },
          { internalType: "address", name: "initAddress", type: "address" },
          {
            internalType: "bytes",
            name: "initCalldata",
            type: "bytes",
          },
        ],
        internalType: "struct Diamond.DiamondCutData",
        name: "_diamondCut",
        type: "tuple",
      },
    ],
    name: "executeUpgrade",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ internalType: "uint256", name: "_chainId", type: "uint256" }],
    name: "freezeChain",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [],
    name: "genesisUpgrade",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "getAllHyperchainChainIDs",
    outputs: [{ internalType: "uint256[]", name: "", type: "uint256[]" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "getAllHyperchains",
    outputs: [{ internalType: "address[]", name: "chainAddresses", type: "address[]" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "uint256", name: "_chainId", type: "uint256" }],
    name: "getChainAdmin",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "uint256", name: "_chainId", type: "uint256" }],
    name: "getHyperchain",
    outputs: [{ internalType: "address", name: "chainAddress", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "getSemverProtocolVersion",
    outputs: [
      { internalType: "uint32", name: "", type: "uint32" },
      {
        internalType: "uint32",
        name: "",
        type: "uint32",
      },
      { internalType: "uint32", name: "", type: "uint32" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "initialCutHash",
    outputs: [{ internalType: "bytes32", name: "", type: "bytes32" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        components: [
          { internalType: "address", name: "owner", type: "address" },
          {
            internalType: "address",
            name: "validatorTimelock",
            type: "address",
          },
          {
            components: [
              {
                internalType: "address",
                name: "genesisUpgrade",
                type: "address",
              },
              { internalType: "bytes32", name: "genesisBatchHash", type: "bytes32" },
              {
                internalType: "uint64",
                name: "genesisIndexRepeatedStorageChanges",
                type: "uint64",
              },
              {
                internalType: "bytes32",
                name: "genesisBatchCommitment",
                type: "bytes32",
              },
              {
                components: [
                  {
                    components: [
                      {
                        internalType: "address",
                        name: "facet",
                        type: "address",
                      },
                      { internalType: "enum Diamond.Action", name: "action", type: "uint8" },
                      {
                        internalType: "bool",
                        name: "isFreezable",
                        type: "bool",
                      },
                      { internalType: "bytes4[]", name: "selectors", type: "bytes4[]" },
                    ],
                    internalType: "struct Diamond.FacetCut[]",
                    name: "facetCuts",
                    type: "tuple[]",
                  },
                  { internalType: "address", name: "initAddress", type: "address" },
                  {
                    internalType: "bytes",
                    name: "initCalldata",
                    type: "bytes",
                  },
                ],
                internalType: "struct Diamond.DiamondCutData",
                name: "diamondCut",
                type: "tuple",
              },
            ],
            internalType: "struct ChainCreationParams",
            name: "chainCreationParams",
            type: "tuple",
          },
          { internalType: "uint256", name: "protocolVersion", type: "uint256" },
        ],
        internalType: "struct StateTransitionManagerInitializeData",
        name: "_initializeData",
        type: "tuple",
      },
    ],
    name: "initialize",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [],
    name: "owner",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "pendingOwner",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "protocolVersion",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "uint256", name: "_protocolVersion", type: "uint256" }],
    name: "protocolVersionDeadline",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "uint256", name: "_protocolVersion", type: "uint256" }],
    name: "protocolVersionIsActive",
    outputs: [{ internalType: "bool", name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "uint256", name: "_chainId", type: "uint256" },
      {
        internalType: "address",
        name: "_hyperchain",
        type: "address",
      },
    ],
    name: "registerAlreadyDeployedHyperchain",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [],
    name: "renounceOwnership",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { internalType: "uint256", name: "_chainId", type: "uint256" },
      {
        internalType: "uint256",
        name: "_newLastBatch",
        type: "uint256",
      },
    ],
    name: "revertBatches",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        components: [
          {
            internalType: "address",
            name: "genesisUpgrade",
            type: "address",
          },
          { internalType: "bytes32", name: "genesisBatchHash", type: "bytes32" },
          {
            internalType: "uint64",
            name: "genesisIndexRepeatedStorageChanges",
            type: "uint64",
          },
          {
            internalType: "bytes32",
            name: "genesisBatchCommitment",
            type: "bytes32",
          },
          {
            components: [
              {
                components: [
                  {
                    internalType: "address",
                    name: "facet",
                    type: "address",
                  },
                  { internalType: "enum Diamond.Action", name: "action", type: "uint8" },
                  {
                    internalType: "bool",
                    name: "isFreezable",
                    type: "bool",
                  },
                  { internalType: "bytes4[]", name: "selectors", type: "bytes4[]" },
                ],
                internalType: "struct Diamond.FacetCut[]",
                name: "facetCuts",
                type: "tuple[]",
              },
              { internalType: "address", name: "initAddress", type: "address" },
              {
                internalType: "bytes",
                name: "initCalldata",
                type: "bytes",
              },
            ],
            internalType: "struct Diamond.DiamondCutData",
            name: "diamondCut",
            type: "tuple",
          },
        ],
        internalType: "struct ChainCreationParams",
        name: "_chainCreationParams",
        type: "tuple",
      },
    ],
    name: "setChainCreationParams",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        components: [
          {
            components: [
              {
                internalType: "address",
                name: "facet",
                type: "address",
              },
              { internalType: "enum Diamond.Action", name: "action", type: "uint8" },
              {
                internalType: "bool",
                name: "isFreezable",
                type: "bool",
              },
              { internalType: "bytes4[]", name: "selectors", type: "bytes4[]" },
            ],
            internalType: "struct Diamond.FacetCut[]",
            name: "facetCuts",
            type: "tuple[]",
          },
          { internalType: "address", name: "initAddress", type: "address" },
          {
            internalType: "bytes",
            name: "initCalldata",
            type: "bytes",
          },
        ],
        internalType: "struct Diamond.DiamondCutData",
        name: "_cutData",
        type: "tuple",
      },
      { internalType: "uint256", name: "_oldProtocolVersion", type: "uint256" },
      {
        internalType: "uint256",
        name: "_oldProtocolVersionDeadline",
        type: "uint256",
      },
      { internalType: "uint256", name: "_newProtocolVersion", type: "uint256" },
    ],
    name: "setNewVersionUpgrade",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ internalType: "address", name: "_newPendingAdmin", type: "address" }],
    name: "setPendingAdmin",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { internalType: "uint256", name: "_chainId", type: "uint256" },
      {
        internalType: "bool",
        name: "_zkPorterIsAvailable",
        type: "bool",
      },
    ],
    name: "setPorterAvailability",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { internalType: "uint256", name: "_chainId", type: "uint256" },
      {
        internalType: "uint256",
        name: "_maxGasLimit",
        type: "uint256",
      },
    ],
    name: "setPriorityTxMaxGasLimit",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { internalType: "uint256", name: "_protocolVersion", type: "uint256" },
      {
        internalType: "uint256",
        name: "_timestamp",
        type: "uint256",
      },
    ],
    name: "setProtocolVersionDeadline",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { internalType: "uint256", name: "_chainId", type: "uint256" },
      {
        internalType: "uint128",
        name: "_nominator",
        type: "uint128",
      },
      { internalType: "uint128", name: "_denominator", type: "uint128" },
    ],
    name: "setTokenMultiplier",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        components: [
          {
            components: [
              {
                internalType: "address",
                name: "facet",
                type: "address",
              },
              { internalType: "enum Diamond.Action", name: "action", type: "uint8" },
              {
                internalType: "bool",
                name: "isFreezable",
                type: "bool",
              },
              { internalType: "bytes4[]", name: "selectors", type: "bytes4[]" },
            ],
            internalType: "struct Diamond.FacetCut[]",
            name: "facetCuts",
            type: "tuple[]",
          },
          { internalType: "address", name: "initAddress", type: "address" },
          {
            internalType: "bytes",
            name: "initCalldata",
            type: "bytes",
          },
        ],
        internalType: "struct Diamond.DiamondCutData",
        name: "_cutData",
        type: "tuple",
      },
      { internalType: "uint256", name: "_oldProtocolVersion", type: "uint256" },
    ],
    name: "setUpgradeDiamondCut",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { internalType: "uint256", name: "_chainId", type: "uint256" },
      {
        internalType: "address",
        name: "_validator",
        type: "address",
      },
      { internalType: "bool", name: "_active", type: "bool" },
    ],
    name: "setValidator",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ internalType: "address", name: "_validatorTimelock", type: "address" }],
    name: "setValidatorTimelock",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [],
    name: "storedBatchZero",
    outputs: [{ internalType: "bytes32", name: "", type: "bytes32" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "address", name: "newOwner", type: "address" }],
    name: "transferOwnership",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ internalType: "uint256", name: "_chainId", type: "uint256" }],
    name: "unfreezeChain",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { internalType: "uint256", name: "_chainId", type: "uint256" },
      {
        internalType: "uint256",
        name: "_oldProtocolVersion",
        type: "uint256",
      },
      {
        components: [
          {
            components: [
              {
                internalType: "address",
                name: "facet",
                type: "address",
              },
              { internalType: "enum Diamond.Action", name: "action", type: "uint8" },
              {
                internalType: "bool",
                name: "isFreezable",
                type: "bool",
              },
              { internalType: "bytes4[]", name: "selectors", type: "bytes4[]" },
            ],
            internalType: "struct Diamond.FacetCut[]",
            name: "facetCuts",
            type: "tuple[]",
          },
          { internalType: "address", name: "initAddress", type: "address" },
          {
            internalType: "bytes",
            name: "initCalldata",
            type: "bytes",
          },
        ],
        internalType: "struct Diamond.DiamondCutData",
        name: "_diamondCut",
        type: "tuple",
      },
    ],
    name: "upgradeChainFromVersion",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ internalType: "uint256", name: "protocolVersion", type: "uint256" }],
    name: "upgradeCutHash",
    outputs: [{ internalType: "bytes32", name: "cutHash", type: "bytes32" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "validatorTimelock",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

const deployerAbi = [
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "accountAddress",
        type: "address",
      },
      {
        indexed: false,
        internalType: "enum IContractDeployer.AccountNonceOrdering",
        name: "nonceOrdering",
        type: "uint8",
      },
    ],
    name: "AccountNonceOrderingUpdated",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "accountAddress",
        type: "address",
      },
      {
        indexed: false,
        internalType: "enum IContractDeployer.AccountAbstractionVersion",
        name: "aaVersion",
        type: "uint8",
      },
    ],
    name: "AccountVersionUpdated",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "deployerAddress",
        type: "address",
      },
      {
        indexed: true,
        internalType: "bytes32",
        name: "bytecodeHash",
        type: "bytes32",
      },
      {
        indexed: true,
        internalType: "address",
        name: "contractAddress",
        type: "address",
      },
    ],
    name: "ContractDeployed",
    type: "event",
  },
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "_salt",
        type: "bytes32",
      },
      {
        internalType: "bytes32",
        name: "_bytecodeHash",
        type: "bytes32",
      },
      {
        internalType: "bytes",
        name: "_input",
        type: "bytes",
      },
    ],
    name: "create",
    outputs: [
      {
        internalType: "address",
        name: "",
        type: "address",
      },
    ],
    stateMutability: "payable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "_salt",
        type: "bytes32",
      },
      {
        internalType: "bytes32",
        name: "_bytecodeHash",
        type: "bytes32",
      },
      {
        internalType: "bytes",
        name: "_input",
        type: "bytes",
      },
    ],
    name: "create2",
    outputs: [
      {
        internalType: "address",
        name: "",
        type: "address",
      },
    ],
    stateMutability: "payable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "_salt",
        type: "bytes32",
      },
      {
        internalType: "bytes32",
        name: "_bytecodeHash",
        type: "bytes32",
      },
      {
        internalType: "bytes",
        name: "_input",
        type: "bytes",
      },
      {
        internalType: "enum IContractDeployer.AccountAbstractionVersion",
        name: "_aaVersion",
        type: "uint8",
      },
    ],
    name: "create2Account",
    outputs: [
      {
        internalType: "address",
        name: "",
        type: "address",
      },
    ],
    stateMutability: "payable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "",
        type: "bytes32",
      },
      {
        internalType: "bytes32",
        name: "_bytecodeHash",
        type: "bytes32",
      },
      {
        internalType: "bytes",
        name: "_input",
        type: "bytes",
      },
      {
        internalType: "enum IContractDeployer.AccountAbstractionVersion",
        name: "_aaVersion",
        type: "uint8",
      },
    ],
    name: "createAccount",
    outputs: [
      {
        internalType: "address",
        name: "",
        type: "address",
      },
    ],
    stateMutability: "payable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "_address",
        type: "address",
      },
    ],
    name: "extendedAccountVersion",
    outputs: [
      {
        internalType: "enum IContractDeployer.AccountAbstractionVersion",
        name: "",
        type: "uint8",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        components: [
          {
            internalType: "bytes32",
            name: "bytecodeHash",
            type: "bytes32",
          },
          {
            internalType: "address",
            name: "newAddress",
            type: "address",
          },
          {
            internalType: "bool",
            name: "callConstructor",
            type: "bool",
          },
          {
            internalType: "uint256",
            name: "value",
            type: "uint256",
          },
          {
            internalType: "bytes",
            name: "input",
            type: "bytes",
          },
        ],
        internalType: "struct ContractDeployer.ForceDeployment",
        name: "_deployment",
        type: "tuple",
      },
      {
        internalType: "address",
        name: "_sender",
        type: "address",
      },
    ],
    name: "forceDeployOnAddress",
    outputs: [],
    stateMutability: "payable",
    type: "function",
  },
  {
    inputs: [
      {
        components: [
          {
            internalType: "bytes32",
            name: "bytecodeHash",
            type: "bytes32",
          },
          {
            internalType: "address",
            name: "newAddress",
            type: "address",
          },
          {
            internalType: "bool",
            name: "callConstructor",
            type: "bool",
          },
          {
            internalType: "uint256",
            name: "value",
            type: "uint256",
          },
          {
            internalType: "bytes",
            name: "input",
            type: "bytes",
          },
        ],
        internalType: "struct ContractDeployer.ForceDeployment[]",
        name: "_deployments",
        type: "tuple[]",
      },
    ],
    name: "forceDeployOnAddresses",
    outputs: [],
    stateMutability: "payable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "_address",
        type: "address",
      },
    ],
    name: "getAccountInfo",
    outputs: [
      {
        components: [
          {
            internalType: "enum IContractDeployer.AccountAbstractionVersion",
            name: "supportedAAVersion",
            type: "uint8",
          },
          {
            internalType: "enum IContractDeployer.AccountNonceOrdering",
            name: "nonceOrdering",
            type: "uint8",
          },
        ],
        internalType: "struct IContractDeployer.AccountInfo",
        name: "info",
        type: "tuple",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "_sender",
        type: "address",
      },
      {
        internalType: "uint256",
        name: "_senderNonce",
        type: "uint256",
      },
    ],
    name: "getNewAddressCreate",
    outputs: [
      {
        internalType: "address",
        name: "newAddress",
        type: "address",
      },
    ],
    stateMutability: "pure",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "_sender",
        type: "address",
      },
      {
        internalType: "bytes32",
        name: "_bytecodeHash",
        type: "bytes32",
      },
      {
        internalType: "bytes32",
        name: "_salt",
        type: "bytes32",
      },
      {
        internalType: "bytes",
        name: "_input",
        type: "bytes",
      },
    ],
    name: "getNewAddressCreate2",
    outputs: [
      {
        internalType: "address",
        name: "newAddress",
        type: "address",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "enum IContractDeployer.AccountAbstractionVersion",
        name: "_version",
        type: "uint8",
      },
    ],
    name: "updateAccountVersion",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "enum IContractDeployer.AccountNonceOrdering",
        name: "_nonceOrdering",
        type: "uint8",
      },
    ],
    name: "updateNonceOrdering",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

type SysContractData = { address: Address; hash: Hex };
type CreateFakeUpgradeOpts = {
  verifier?: Address;
  systemContracts?: Array<SysContractData>;
  newVersion?: bigint;
};

const defaultOpts = {
  verifier: zeroAddress,
  systemContracts: [],
  newVersion: 103079215107n,
};

function encodeForceL2Deploy(data: SysContractData[]): Hex {
  const args = data.map((sysContract) => {
    return {
      bytecodeHash: sysContract.hash,
      newAddress: sysContract.address,
      callConstructor: false,
      value: 0n,
      input: "0x" as Hex,
    };
  });

  return encodeFunctionData({
    abi: deployerAbi,
    functionName: "forceDeployOnAddresses",
    args: [args],
  });
}

type SemVer = {
  major: bigint;
  minor: bigint;
  patch: bigint;
};

function destructureSemver(version: bigint): SemVer {
  let bytes = Buffer.from(numberToBytes(version));
  const patch = bytesToBigInt(bytes.subarray(-4));
  bytes = bytes.subarray(0, -4);
  const minor = bytesToBigInt(bytes.subarray(-4));
  bytes = bytes.subarray(0, -4);
  const rowMajor = bytes.subarray(-4);
  const major = rowMajor.length === 0 ? 0n : bytesToBigInt(rowMajor);

  return {
    patch,
    minor,
    major,
  };
}

function buildL2Tx(systemContracts: SysContractData[], newVersion: bigint) {
  const empty = systemContracts.length === 0;
  const { minor } = destructureSemver(newVersion);

  const data = empty ? "0x" : encodeForceL2Deploy(systemContracts);

  return {
    txType: empty ? 0n : 254n,
    from: empty ? 0n : hexToBigInt("0x0000000000000000000000000000000000008007"),
    to: empty ? 0n : hexToBigInt("0x0000000000000000000000000000000000008006"),
    gasLimit: empty ? 0n : 72000000n,
    gasPerPubdataByteLimit: empty ? 0n : 800n,
    maxFeePerGas: 0n,
    maxPriorityFeePerGas: 0n,
    paymaster: 0n,
    nonce: minor,
    value: 0n,
    reserved: [0n, 0n, 0n, 0n] as [bigint, bigint, bigint, bigint],
    data: data as Hex,
    signature: hexSchema.parse("0x"),
    factoryDeps: [],
    paymasterInput: "0x" as Hex,
    reservedDynamic: "0x" as Hex,
  };
}

export async function createFakeUpgrade(
  transitionManager: StateTransitionManager,
  rpc: RpcClient,
  rawOpts: CreateFakeUpgradeOpts = {}
): Promise<Hex> {
  const opts = Object.assign({}, defaultOpts, rawOpts);
  const someHyperchainId = await transitionManager.allHyperchainIds(rpc).then((all) => all[0]);

  if (someHyperchainId === undefined) {
    throw new Error("error");
  }

  const innerCalldata = encodeFunctionData({
    abi: defaultUpgradeAbi,
    functionName: "upgrade",
    args: [
      {
        l2ProtocolUpgradeTx: buildL2Tx(opts.systemContracts, opts.newVersion),
        factoryDeps: [],
        bootloaderHash: padHex("0x0"),
        defaultAccountHash: padHex("0x"),
        verifier: opts.verifier,
        verifierParams: {
          recursionNodeLevelVkHash: padHex("0x"),
          recursionLeafLevelVkHash: padHex("0x"),
          recursionCircuitsSetVksHash: padHex("0x"),
        },
        l1ContractsUpgradeCalldata: "0x",
        postUpgradeCalldata: "0x",
        upgradeTimestamp: 0n,
        newProtocolVersion: opts.newVersion,
      },
    ],
  });

  return encodeFunctionData({
    abi: stateTransitionManagerAbi,
    functionName: "executeUpgrade",
    args: [
      someHyperchainId,
      {
        facetCuts: [],
        initAddress: "0x4d376798Ba8F69cEd59642c3AE8687c7457e855d",
        initCalldata: innerCalldata,
      },
    ],
  });
}
