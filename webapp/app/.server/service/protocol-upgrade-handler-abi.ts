import { ContractAbi } from "validate-cli/src/lib/contract-abi";
import type { Abi } from "viem";

const PROTOCOL_UPGRADE_HANDLER_RAW_ABI: Abi = [
  {
    type: "constructor",
    inputs: [
      {
        name: "_securityCouncil",
        type: "address",
        internalType: "address",
      },
      {
        name: "_guardians",
        type: "address",
        internalType: "address",
      },
      {
        name: "_emergencyUpgradeBoard",
        type: "address",
        internalType: "address",
      },
      {
        name: "_l2ProtocolGovernor",
        type: "address",
        internalType: "address",
      },
      {
        name: "_ZKsyncEra",
        type: "address",
        internalType: "contract IZKsyncEra",
      },
      {
        name: "_stateTransitionManager",
        type: "address",
        internalType: "contract IStateTransitionManager",
      },
      {
        name: "_bridgeHub",
        type: "address",
        internalType: "contract IPausable",
      },
      {
        name: "_sharedBridge",
        type: "address",
        internalType: "contract IPausable",
      },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "receive",
    stateMutability: "payable",
  },
  {
    type: "function",
    name: "BRIDGE_HUB",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "contract IPausable",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "L2_PROTOCOL_GOVERNOR",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "address",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "SHARED_BRIDGE",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "contract IPausable",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "STATE_TRANSITION_MANAGER",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "contract IStateTransitionManager",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "ZKSYNC_ERA",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "contract IZKsyncEra",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "approveUpgradeGuardians",
    inputs: [
      {
        name: "_id",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "approveUpgradeSecurityCouncil",
    inputs: [
      {
        name: "_id",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "emergencyUpgradeBoard",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "address",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "execute",
    inputs: [
      {
        name: "_proposal",
        type: "tuple",
        internalType: "struct IProtocolUpgradeHandler.UpgradeProposal",
        components: [
          {
            name: "calls",
            type: "tuple[]",
            internalType: "struct IProtocolUpgradeHandler.Call[]",
            components: [
              {
                name: "target",
                type: "address",
                internalType: "address",
              },
              {
                name: "value",
                type: "uint256",
                internalType: "uint256",
              },
              {
                name: "data",
                type: "bytes",
                internalType: "bytes",
              },
            ],
          },
          {
            name: "executor",
            type: "address",
            internalType: "address",
          },
          {
            name: "salt",
            type: "bytes32",
            internalType: "bytes32",
          },
        ],
      },
    ],
    outputs: [],
    stateMutability: "payable",
  },
  {
    type: "function",
    name: "executeEmergencyUpgrade",
    inputs: [
      {
        name: "_proposal",
        type: "tuple",
        internalType: "struct IProtocolUpgradeHandler.UpgradeProposal",
        components: [
          {
            name: "calls",
            type: "tuple[]",
            internalType: "struct IProtocolUpgradeHandler.Call[]",
            components: [
              {
                name: "target",
                type: "address",
                internalType: "address",
              },
              {
                name: "value",
                type: "uint256",
                internalType: "uint256",
              },
              {
                name: "data",
                type: "bytes",
                internalType: "bytes",
              },
            ],
          },
          {
            name: "executor",
            type: "address",
            internalType: "address",
          },
          {
            name: "salt",
            type: "bytes32",
            internalType: "bytes32",
          },
        ],
      },
    ],
    outputs: [],
    stateMutability: "payable",
  },
  {
    type: "function",
    name: "extendLegalVeto",
    inputs: [
      {
        name: "_id",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "guardians",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "address",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "hardFreeze",
    inputs: [],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "lastFreezeStatusInUpgradeCycle",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint8",
        internalType: "enum IProtocolUpgradeHandler.FreezeStatus",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "reinforceFreeze",
    inputs: [],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "reinforceFreezeOneChain",
    inputs: [
      {
        name: "_chainId",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "reinforceUnfreeze",
    inputs: [],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "reinforceUnfreezeOneChain",
    inputs: [
      {
        name: "_chainId",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "securityCouncil",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "address",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "softFreeze",
    inputs: [],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "startUpgrade",
    inputs: [
      {
        name: "_l2BatchNumber",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "_l2MessageIndex",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "_l2TxNumberInBatch",
        type: "uint16",
        internalType: "uint16",
      },
      {
        name: "_proof",
        type: "bytes32[]",
        internalType: "bytes32[]",
      },
      {
        name: "_proposal",
        type: "tuple",
        internalType: "struct IProtocolUpgradeHandler.UpgradeProposal",
        components: [
          {
            name: "calls",
            type: "tuple[]",
            internalType: "struct IProtocolUpgradeHandler.Call[]",
            components: [
              {
                name: "target",
                type: "address",
                internalType: "address",
              },
              {
                name: "value",
                type: "uint256",
                internalType: "uint256",
              },
              {
                name: "data",
                type: "bytes",
                internalType: "bytes",
              },
            ],
          },
          {
            name: "executor",
            type: "address",
            internalType: "address",
          },
          {
            name: "salt",
            type: "bytes32",
            internalType: "bytes32",
          },
        ],
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "unfreeze",
    inputs: [],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "updateEmergencyUpgradeBoard",
    inputs: [
      {
        name: "_newEmergencyUpgradeBoard",
        type: "address",
        internalType: "address",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "updateGuardians",
    inputs: [
      {
        name: "_newGuardians",
        type: "address",
        internalType: "address",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "updateSecurityCouncil",
    inputs: [
      {
        name: "_newSecurityCouncil",
        type: "address",
        internalType: "address",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "upgradeState",
    inputs: [
      {
        name: "_id",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    outputs: [
      {
        name: "",
        type: "uint8",
        internalType: "enum IProtocolUpgradeHandler.UpgradeState",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "upgradeStatus",
    inputs: [
      {
        name: "upgradeId",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    outputs: [
      {
        name: "creationTimestamp",
        type: "uint48",
        internalType: "uint48",
      },
      {
        name: "securityCouncilApprovalTimestamp",
        type: "uint48",
        internalType: "uint48",
      },
      {
        name: "guardiansApproval",
        type: "bool",
        internalType: "bool",
      },
      {
        name: "guardiansExtendedLegalVeto",
        type: "bool",
        internalType: "bool",
      },
      {
        name: "executed",
        type: "bool",
        internalType: "bool",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "event",
    name: "ChangeEmergencyUpgradeBoard",
    inputs: [
      {
        name: "_emergencyUpgradeBoardBefore",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "_emergencyUpgradeBoardAfter",
        type: "address",
        indexed: true,
        internalType: "address",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "ChangeGuardians",
    inputs: [
      {
        name: "_guardiansBefore",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "_guardiansAfter",
        type: "address",
        indexed: true,
        internalType: "address",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "ChangeSecurityCouncil",
    inputs: [
      {
        name: "_securityCouncilBefore",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "_securityCouncilAfter",
        type: "address",
        indexed: true,
        internalType: "address",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "EmergencyUpgradeExecuted",
    inputs: [
      {
        name: "_id",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "HardFreeze",
    inputs: [
      {
        name: "_protocolFrozenUntil",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "ReinforceFreeze",
    inputs: [],
    anonymous: false,
  },
  {
    type: "event",
    name: "ReinforceFreezeOneChain",
    inputs: [
      {
        name: "_chainId",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "ReinforceUnfreeze",
    inputs: [],
    anonymous: false,
  },
  {
    type: "event",
    name: "ReinforceUnfreezeOneChain",
    inputs: [
      {
        name: "_chainId",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "SoftFreeze",
    inputs: [
      {
        name: "_protocolFrozenUntil",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "Unfreeze",
    inputs: [],
    anonymous: false,
  },
  {
    type: "event",
    name: "UpgradeApprovedByGuardians",
    inputs: [
      {
        name: "_id",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "UpgradeApprovedBySecurityCouncil",
    inputs: [
      {
        name: "_id",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "UpgradeExecuted",
    inputs: [
      {
        name: "_id",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "UpgradeLegalVetoExtended",
    inputs: [
      {
        name: "_id",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "UpgradeStarted",
    inputs: [
      {
        name: "_id",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
      {
        name: "_proposal",
        type: "tuple",
        indexed: false,
        internalType: "struct IProtocolUpgradeHandler.UpgradeProposal",
        components: [
          {
            name: "calls",
            type: "tuple[]",
            internalType: "struct IProtocolUpgradeHandler.Call[]",
            components: [
              {
                name: "target",
                type: "address",
                internalType: "address",
              },
              {
                name: "value",
                type: "uint256",
                internalType: "uint256",
              },
              {
                name: "data",
                type: "bytes",
                internalType: "bytes",
              },
            ],
          },
          {
            name: "executor",
            type: "address",
            internalType: "address",
          },
          {
            name: "salt",
            type: "bytes32",
            internalType: "bytes32",
          },
        ],
      },
    ],
    anonymous: false,
  },
];

const GUARDIANS_RAW_ABI: Abi = [
  {
    type: "constructor",
    inputs: [
      {
        name: "_protocolUpgradeHandler",
        type: "address",
        internalType: "contract IProtocolUpgradeHandler"
      },
      {
        name: "_ZKsyncEra",
        type: "address",
        internalType: "contract IZKsyncEra"
      },
      {
        name: "_members",
        type: "address[]",
        internalType: "address[]"
      }
    ],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "APPROVE_UPGRADE_GUARDIANS_THRESHOLD",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint256",
        internalType: "uint256"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "CANCEL_L2_GOVERNOR_PROPOSAL_THRESHOLD",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint256",
        internalType: "uint256"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "EIP1271_THRESHOLD",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint256",
        internalType: "uint256"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "EXTEND_LEGAL_VETO_THRESHOLD",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint256",
        internalType: "uint256"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "PROPOSE_L2_GOVERNOR_PROPOSAL_THRESHOLD",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint256",
        internalType: "uint256"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "PROTOCOL_UPGRADE_HANDLER",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "contract IProtocolUpgradeHandler"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "ZKSYNC_ERA",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "contract IZKsyncEra"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "approveUpgradeGuardians",
    inputs: [
      {
        name: "_id",
        type: "bytes32",
        internalType: "bytes32"
      },
      {
        name: "_signers",
        type: "address[]",
        internalType: "address[]"
      },
      {
        name: "_signatures",
        type: "bytes[]",
        internalType: "bytes[]"
      }
    ],
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "cancelL2GovernorProposal",
    inputs: [
      {
        name: "_l2Proposal",
        type: "tuple",
        internalType: "struct IGuardians.L2GovernorProposal",
        components: [
          {
            name: "targets",
            type: "address[]",
            internalType: "address[]"
          },
          {
            name: "values",
            type: "uint256[]",
            internalType: "uint256[]"
          },
          {
            name: "calldatas",
            type: "bytes[]",
            internalType: "bytes[]"
          },
          {
            name: "description",
            type: "string",
            internalType: "string"
          }
        ]
      },
      {
        name: "_txRequest",
        type: "tuple",
        internalType: "struct IGuardians.TxRequest",
        components: [
          {
            name: "to",
            type: "address",
            internalType: "address"
          },
          {
            name: "l2GasLimit",
            type: "uint256",
            internalType: "uint256"
          },
          {
            name: "l2GasPerPubdataByteLimit",
            type: "uint256",
            internalType: "uint256"
          },
          {
            name: "refundRecipient",
            type: "address",
            internalType: "address"
          },
          {
            name: "txMintValue",
            type: "uint256",
            internalType: "uint256"
          }
        ]
      },
      {
        name: "_signers",
        type: "address[]",
        internalType: "address[]"
      },
      {
        name: "_signatures",
        type: "bytes[]",
        internalType: "bytes[]"
      }
    ],
    outputs: [],
    stateMutability: "payable"
  },
  {
    type: "function",
    name: "checkSignatures",
    inputs: [
      {
        name: "_digest",
        type: "bytes32",
        internalType: "bytes32"
      },
      {
        name: "_signers",
        type: "address[]",
        internalType: "address[]"
      },
      {
        name: "_signatures",
        type: "bytes[]",
        internalType: "bytes[]"
      },
      {
        name: "_threshold",
        type: "uint256",
        internalType: "uint256"
      }
    ],
    outputs: [],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "eip712Domain",
    inputs: [],
    outputs: [
      {
        name: "fields",
        type: "bytes1",
        internalType: "bytes1"
      },
      {
        name: "name",
        type: "string",
        internalType: "string"
      },
      {
        name: "version",
        type: "string",
        internalType: "string"
      },
      {
        name: "chainId",
        type: "uint256",
        internalType: "uint256"
      },
      {
        name: "verifyingContract",
        type: "address",
        internalType: "address"
      },
      {
        name: "salt",
        type: "bytes32",
        internalType: "bytes32"
      },
      {
        name: "extensions",
        type: "uint256[]",
        internalType: "uint256[]"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "extendLegalVeto",
    inputs: [
      {
        name: "_id",
        type: "bytes32",
        internalType: "bytes32"
      },
      {
        name: "_signers",
        type: "address[]",
        internalType: "address[]"
      },
      {
        name: "_signatures",
        type: "bytes[]",
        internalType: "bytes[]"
      }
    ],
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "hashL2Proposal",
    inputs: [
      {
        name: "_l2Proposal",
        type: "tuple",
        internalType: "struct IGuardians.L2GovernorProposal",
        components: [
          {
            name: "targets",
            type: "address[]",
            internalType: "address[]"
          },
          {
            name: "values",
            type: "uint256[]",
            internalType: "uint256[]"
          },
          {
            name: "calldatas",
            type: "bytes[]",
            internalType: "bytes[]"
          },
          {
            name: "description",
            type: "string",
            internalType: "string"
          }
        ]
      }
    ],
    outputs: [
      {
        name: "proposalId",
        type: "uint256",
        internalType: "uint256"
      }
    ],
    stateMutability: "pure"
  },
  {
    type: "function",
    name: "isValidSignature",
    inputs: [
      {
        name: "_digest",
        type: "bytes32",
        internalType: "bytes32"
      },
      {
        name: "_signature",
        type: "bytes",
        internalType: "bytes"
      }
    ],
    outputs: [
      {
        name: "",
        type: "bytes4",
        internalType: "bytes4"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "members",
    inputs: [
      {
        name: "",
        type: "uint256",
        internalType: "uint256"
      }
    ],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "address"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "nonce",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint256",
        internalType: "uint256"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "proposeL2GovernorProposal",
    inputs: [
      {
        name: "_l2Proposal",
        type: "tuple",
        internalType: "struct IGuardians.L2GovernorProposal",
        components: [
          {
            name: "targets",
            type: "address[]",
            internalType: "address[]"
          },
          {
            name: "values",
            type: "uint256[]",
            internalType: "uint256[]"
          },
          {
            name: "calldatas",
            type: "bytes[]",
            internalType: "bytes[]"
          },
          {
            name: "description",
            type: "string",
            internalType: "string"
          }
        ]
      },
      {
        name: "_txRequest",
        type: "tuple",
        internalType: "struct IGuardians.TxRequest",
        components: [
          {
            name: "to",
            type: "address",
            internalType: "address"
          },
          {
            name: "l2GasLimit",
            type: "uint256",
            internalType: "uint256"
          },
          {
            name: "l2GasPerPubdataByteLimit",
            type: "uint256",
            internalType: "uint256"
          },
          {
            name: "refundRecipient",
            type: "address",
            internalType: "address"
          },
          {
            name: "txMintValue",
            type: "uint256",
            internalType: "uint256"
          }
        ]
      },
      {
        name: "_signers",
        type: "address[]",
        internalType: "address[]"
      },
      {
        name: "_signatures",
        type: "bytes[]",
        internalType: "bytes[]"
      }
    ],
    outputs: [],
    stateMutability: "payable"
  },
  {
    type: "event",
    name: "EIP712DomainChanged",
    inputs: [],
    anonymous: false
  },
  {
    type: "error",
    name: "InvalidShortString",
    inputs: []
  },
  {
    type: "error",
    name: "StringTooLong",
    inputs: [
      {
        name: "str",
        type: "string",
        internalType: "string"
      }
    ]
  }
]

const SEC_COUNCIL_RAW_ABI: Abi = [
  {
    type: "constructor",
    inputs: [
      {
        name: "_protocolUpgradeHandler",
        type: "address",
        internalType: "contract IProtocolUpgradeHandler"
      },
      {
        name: "_members",
        type: "address[]",
        internalType: "address[]"
      }
    ],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "APPROVE_UPGRADE_SECURITY_COUNCIL_THRESHOLD",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint256",
        internalType: "uint256"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "EIP1271_THRESHOLD",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint256",
        internalType: "uint256"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "HARD_FREEZE_THRESHOLD",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint256",
        internalType: "uint256"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "PROTOCOL_UPGRADE_HANDLER",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "contract IProtocolUpgradeHandler"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "RECOMMENDED_SOFT_FREEZE_THRESHOLD",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint256",
        internalType: "uint256"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "SOFT_FREEZE_CONSERVATIVE_THRESHOLD",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint256",
        internalType: "uint256"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "UNFREEZE_THRESHOLD",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint256",
        internalType: "uint256"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "approveUpgradeSecurityCouncil",
    inputs: [
      {
        name: "_id",
        type: "bytes32",
        internalType: "bytes32"
      },
      {
        name: "_signers",
        type: "address[]",
        internalType: "address[]"
      },
      {
        name: "_signatures",
        type: "bytes[]",
        internalType: "bytes[]"
      }
    ],
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "checkSignatures",
    inputs: [
      {
        name: "_digest",
        type: "bytes32",
        internalType: "bytes32"
      },
      {
        name: "_signers",
        type: "address[]",
        internalType: "address[]"
      },
      {
        name: "_signatures",
        type: "bytes[]",
        internalType: "bytes[]"
      },
      {
        name: "_threshold",
        type: "uint256",
        internalType: "uint256"
      }
    ],
    outputs: [],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "eip712Domain",
    inputs: [],
    outputs: [
      {
        name: "fields",
        type: "bytes1",
        internalType: "bytes1"
      },
      {
        name: "name",
        type: "string",
        internalType: "string"
      },
      {
        name: "version",
        type: "string",
        internalType: "string"
      },
      {
        name: "chainId",
        type: "uint256",
        internalType: "uint256"
      },
      {
        name: "verifyingContract",
        type: "address",
        internalType: "address"
      },
      {
        name: "salt",
        type: "bytes32",
        internalType: "bytes32"
      },
      {
        name: "extensions",
        type: "uint256[]",
        internalType: "uint256[]"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "hardFreeze",
    inputs: [
      {
        name: "_validUntil",
        type: "uint256",
        internalType: "uint256"
      },
      {
        name: "_signers",
        type: "address[]",
        internalType: "address[]"
      },
      {
        name: "_signatures",
        type: "bytes[]",
        internalType: "bytes[]"
      }
    ],
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "hardFreezeNonce",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint256",
        internalType: "uint256"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "isValidSignature",
    inputs: [
      {
        name: "_digest",
        type: "bytes32",
        internalType: "bytes32"
      },
      {
        name: "_signature",
        type: "bytes",
        internalType: "bytes"
      }
    ],
    outputs: [
      {
        name: "",
        type: "bytes4",
        internalType: "bytes4"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "members",
    inputs: [
      {
        name: "",
        type: "uint256",
        internalType: "uint256"
      }
    ],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "address"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "setSoftFreezeThreshold",
    inputs: [
      {
        name: "_threshold",
        type: "uint256",
        internalType: "uint256"
      },
      {
        name: "_validUntil",
        type: "uint256",
        internalType: "uint256"
      },
      {
        name: "_signers",
        type: "address[]",
        internalType: "address[]"
      },
      {
        name: "_signatures",
        type: "bytes[]",
        internalType: "bytes[]"
      }
    ],
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "softFreeze",
    inputs: [
      {
        name: "_validUntil",
        type: "uint256",
        internalType: "uint256"
      },
      {
        name: "_signers",
        type: "address[]",
        internalType: "address[]"
      },
      {
        name: "_signatures",
        type: "bytes[]",
        internalType: "bytes[]"
      }
    ],
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "softFreezeNonce",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint256",
        internalType: "uint256"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "softFreezeThreshold",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint256",
        internalType: "uint256"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "softFreezeThresholdSettingNonce",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint256",
        internalType: "uint256"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "unfreeze",
    inputs: [
      {
        name: "_validUntil",
        type: "uint256",
        internalType: "uint256"
      },
      {
        name: "_signers",
        type: "address[]",
        internalType: "address[]"
      },
      {
        name: "_signatures",
        type: "bytes[]",
        internalType: "bytes[]"
      }
    ],
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "unfreezeNonce",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint256",
        internalType: "uint256"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "event",
    name: "EIP712DomainChanged",
    inputs: [],
    anonymous: false
  },
  {
    type: "error",
    name: "InvalidShortString",
    inputs: []
  },
  {
    type: "error",
    name: "StringTooLong",
    inputs: [
      {
        name: "str",
        type: "string",
        internalType: "string"
      }
    ]
  }
]

export const upgradeHandlerAbi = new ContractAbi(PROTOCOL_UPGRADE_HANDLER_RAW_ABI);
export const guardiansAbi = new ContractAbi(GUARDIANS_RAW_ABI)
export const scAbi = new ContractAbi(SEC_COUNCIL_RAW_ABI)