/**
 * Inline ABI definitions for the ProtocolUpgradeHandler reinforce functions and
 * related view accessors. These supplement the compiled artifact ABI which may
 * not yet include these functions in all environments.
 */

export const protocolUpgradeHandlerReinforceAbi = [
  // State accessors
  {
    type: "function",
    name: "protocolFrozenUntil",
    inputs: [],
    outputs: [{ type: "uint256", name: "" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "lastFreezeStatusInUpgradeCycle",
    inputs: [],
    outputs: [{ type: "uint8", name: "" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "STATE_TRANSITION_MANAGER",
    inputs: [],
    outputs: [{ type: "address", name: "" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "BRIDGE_HUB",
    inputs: [],
    outputs: [{ type: "address", name: "" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "SHARED_BRIDGE",
    inputs: [],
    outputs: [{ type: "address", name: "" }],
    stateMutability: "view",
  },
  // Reinforce freeze functions
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
    inputs: [{ type: "uint256", name: "_chainId" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  // Reinforce unfreeze functions
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
    inputs: [{ type: "uint256", name: "_chainId" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  // Events
  {
    type: "event",
    name: "ReinforceFreeze",
    inputs: [],
    anonymous: false,
  },
  {
    type: "event",
    name: "ReinforceFreezeOneChain",
    inputs: [{ type: "uint256", name: "_chainId", indexed: false }],
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
    inputs: [{ type: "uint256", name: "_chainId", indexed: false }],
    anonymous: false,
  },
  {
    type: "event",
    name: "SoftFreeze",
    inputs: [{ type: "uint256", name: "_protocolFrozenUntil", indexed: false }],
    anonymous: false,
  },
  {
    type: "event",
    name: "HardFreeze",
    inputs: [{ type: "uint256", name: "_protocolFrozenUntil", indexed: false }],
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
    name: "EmergencyUpgradeExecuted",
    inputs: [{ type: "bytes32", name: "_id", indexed: true }],
    anonymous: false,
  },
] as const;

export const stateTransitionManagerAbi = [
  {
    type: "function",
    name: "getAllHyperchainChainIDs",
    inputs: [],
    outputs: [{ type: "uint256[]", name: "" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "freezeChain",
    inputs: [{ type: "uint256", name: "_chainId" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "unfreezeChain",
    inputs: [{ type: "uint256", name: "_chainId" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const;

/**
 * FreezeStatus enum values matching the contract.
 * 0 = None, 1 = Soft, 2 = Hard, 3 = AfterSoftFreeze, 4 = AfterHardFreeze
 */
export const FreezeStatus = {
  None: 0,
  Soft: 1,
  Hard: 2,
  AfterSoftFreeze: 3,
  AfterHardFreeze: 4,
} as const;

export type FreezeStatusValue = (typeof FreezeStatus)[keyof typeof FreezeStatus];

export function freezeStatusLabel(status: number): string {
  switch (status) {
    case FreezeStatus.None:
      return "None";
    case FreezeStatus.Soft:
      return "Soft Freeze Active";
    case FreezeStatus.Hard:
      return "Hard Freeze Active";
    case FreezeStatus.AfterSoftFreeze:
      return "After Soft Freeze";
    case FreezeStatus.AfterHardFreeze:
      return "After Hard Freeze";
    default:
      return "Unknown";
  }
}

/** Returns true when the protocol is expected to be in a frozen state. */
export function isProtocolFrozen(
  protocolFrozenUntil: bigint,
  lastFreezeStatus: number
): boolean {
  const nowSec = BigInt(Math.floor(Date.now() / 1000));
  return (
    protocolFrozenUntil > nowSec &&
    (lastFreezeStatus === FreezeStatus.Soft || lastFreezeStatus === FreezeStatus.Hard)
  );
}

/** Returns true when the protocol is expected to be unfrozen. */
export function isProtocolUnfrozen(
  protocolFrozenUntil: bigint,
  lastFreezeStatus: number
): boolean {
  const nowSec = BigInt(Math.floor(Date.now() / 1000));
  return (
    protocolFrozenUntil === 0n ||
    nowSec > protocolFrozenUntil ||
    lastFreezeStatus === FreezeStatus.AfterSoftFreeze ||
    lastFreezeStatus === FreezeStatus.AfterHardFreeze
  );
}
