import { env } from "@config/env.server";
import { getContract, type Address, type Hex } from "viem";

import { l1Rpc } from "../client";
import { upgradeHandlerAbi } from "@/utils/contract-abis";
import { protocolUpgradeHandlerReinforceAbi } from "@/utils/reinforce-abis";
import { EthereumConfig } from "@config/ethereum.server";

const upgradeHandler = getContract({
  address: env.UPGRADE_HANDLER_ADDRESS,
  abi: upgradeHandlerAbi,
  client: l1Rpc,
});

// Separate contract instance with the extended ABI that includes reinforce
// functions and freeze-state accessors not present in the compiled artifact.
const upgradeHandlerExtended = getContract({
  address: env.UPGRADE_HANDLER_ADDRESS,
  abi: protocolUpgradeHandlerReinforceAbi,
  client: l1Rpc,
});

export async function guardiansAddress() {
  return upgradeHandler.read.guardians();
}

export async function securityCouncilAddress() {
  return upgradeHandler.read.securityCouncil();
}

export async function emergencyUpgradeBoardAddress() {
  return upgradeHandler.read.emergencyUpgradeBoard();
}

export async function getUpgradeStartedEvents(params: { fromBlock: bigint; toBlock: bigint }) {
  const blocksInADay = BigInt(Math.floor((24 * 60 * 60) / EthereumConfig.l1.blockTime));

  const calls = [];
  let currentFromBlock = params.fromBlock;
  while (currentFromBlock + blocksInADay < params.toBlock) {
    calls.push(
      upgradeHandler.getEvents.UpgradeStarted(undefined, {
        fromBlock: currentFromBlock,
        toBlock: currentFromBlock + blocksInADay - 1n,
      })
    );
    currentFromBlock += blocksInADay;
  }
  calls.push(
    upgradeHandler.getEvents.UpgradeStarted(undefined, {
      fromBlock: currentFromBlock,
      toBlock: params.toBlock,
    })
  );

  return Promise.all(calls).then((lists) => lists.flat());
}

export async function getUpgradeState(id: Hex) {
  return upgradeHandler.read.upgradeState([id]);
}

export async function getUpgradeStatus(id: Hex) {
  const [
    creationTimestamp,
    securityCouncilApprovalTimestamp,
    guardiansApproval,
    guardiansExtendedLegalVeto,
    executed,
  ] = await upgradeHandler.read.upgradeStatus([id]);
  return {
    creationTimestamp,
    securityCouncilApprovalTimestamp,
    guardiansApproval,
    guardiansExtendedLegalVeto,
    executed,
  };
}

// ---------------------------------------------------------------------------
// Freeze state
// ---------------------------------------------------------------------------

export async function getProtocolFreezeState(): Promise<{
  protocolFrozenUntil: bigint;
  lastFreezeStatusInUpgradeCycle: number;
}> {
  const [protocolFrozenUntil, lastFreezeStatusInUpgradeCycle] = await Promise.all([
    upgradeHandlerExtended.read.protocolFrozenUntil(),
    upgradeHandlerExtended.read.lastFreezeStatusInUpgradeCycle(),
  ]);
  return { protocolFrozenUntil, lastFreezeStatusInUpgradeCycle };
}

export async function getStateTransitionManagerAddress(): Promise<Address> {
  return upgradeHandlerExtended.read.STATE_TRANSITION_MANAGER();
}

export async function getBridgeHubAddress(): Promise<Address> {
  return upgradeHandlerExtended.read.BRIDGE_HUB();
}

export async function getSharedBridgeAddress(): Promise<Address> {
  return upgradeHandlerExtended.read.SHARED_BRIDGE();
}

// ---------------------------------------------------------------------------
// Reinforce events – used to track which chains have already been reinforced
// in the current freeze / unfreeze cycle.
// ---------------------------------------------------------------------------

/** Returns the block number at which the most recent freeze event was emitted. */
export async function getLastFreezeBlockNumber(): Promise<bigint | null> {
  const latestBlock = await l1Rpc.getBlockNumber();
  // Search last 7 days of blocks for freeze events
  const blocksInAWeek = BigInt(Math.floor((7 * 24 * 60 * 60) / EthereumConfig.l1.blockTime));
  const fromBlock =
    latestBlock > blocksInAWeek ? latestBlock - blocksInAWeek : 0n;

  const [softEvents, hardEvents] = await Promise.all([
    upgradeHandlerExtended.getEvents.SoftFreeze(undefined, {
      fromBlock,
      toBlock: latestBlock,
    }),
    upgradeHandlerExtended.getEvents.HardFreeze(undefined, {
      fromBlock,
      toBlock: latestBlock,
    }),
  ]);

  const allFreezeEvents = [...softEvents, ...hardEvents].sort((a, b) =>
    Number(b.blockNumber ?? 0n) - Number(a.blockNumber ?? 0n)
  );

  return allFreezeEvents[0]?.blockNumber ?? null;
}

/** Returns chain IDs that have had `ReinforceFreezeOneChain` emitted since `fromBlock`. */
export async function getReinforcedFreezeChainIds(fromBlock: bigint): Promise<bigint[]> {
  const latestBlock = await l1Rpc.getBlockNumber();
  const events = await upgradeHandlerExtended.getEvents.ReinforceFreezeOneChain(undefined, {
    fromBlock,
    toBlock: latestBlock,
  });
  return events.map((e) => e.args._chainId).filter((id): id is bigint => id !== undefined);
}

/** Returns chain IDs that have had `ReinforceUnfreezeOneChain` emitted since `fromBlock`. */
export async function getReinforcedUnfreezeChainIds(fromBlock: bigint): Promise<bigint[]> {
  const latestBlock = await l1Rpc.getBlockNumber();
  const events = await upgradeHandlerExtended.getEvents.ReinforceUnfreezeOneChain(undefined, {
    fromBlock,
    toBlock: latestBlock,
  });
  return events.map((e) => e.args._chainId).filter((id): id is bigint => id !== undefined);
}

/**
 * Returns the block number of the most recent `Unfreeze` event, used to
 * correlate ReinforceUnfreezeOneChain events to the current unfreeze cycle.
 */
export async function getLastUnfreezeBlockNumber(): Promise<bigint | null> {
  const latestBlock = await l1Rpc.getBlockNumber();
  const blocksInAWeek = BigInt(Math.floor((7 * 24 * 60 * 60) / EthereumConfig.l1.blockTime));
  const fromBlock =
    latestBlock > blocksInAWeek ? latestBlock - blocksInAWeek : 0n;

  const events = await upgradeHandlerExtended.getEvents.Unfreeze(undefined, {
    fromBlock,
    toBlock: latestBlock,
  });
  const sorted = [...events].sort(
    (a, b) => Number(b.blockNumber ?? 0n) - Number(a.blockNumber ?? 0n)
  );
  return sorted[0]?.blockNumber ?? null;
}

/**
 * Returns the block number of the most recent EmergencyUpgradeExecuted event,
 * used to detect a front-run situation where an emergency upgrade already
 * cleared the freeze but not all chains were unfrozen first.
 */
export async function getLastEmergencyUpgradeBlockNumber(): Promise<bigint | null> {
  const latestBlock = await l1Rpc.getBlockNumber();
  const blocksInAWeek = BigInt(Math.floor((7 * 24 * 60 * 60) / EthereumConfig.l1.blockTime));
  const fromBlock = latestBlock > blocksInAWeek ? latestBlock - blocksInAWeek : 0n;

  const events = await upgradeHandlerExtended.getEvents.EmergencyUpgradeExecuted(undefined, {
    fromBlock,
    toBlock: latestBlock,
  });
  const sorted = [...events].sort(
    (a, b) => Number(b.blockNumber ?? 0n) - Number(a.blockNumber ?? 0n)
  );
  return sorted[0]?.blockNumber ?? null;
}
