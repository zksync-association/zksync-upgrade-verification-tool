import { env } from "@config/env.server";
import { getContract, type Hex } from "viem";

import { l1Rpc } from "../client";
import { upgradeHandlerAbi } from "@/utils/contract-abis";
import { EthereumConfig } from '@config/ethereum.server';

const upgradeHandler = getContract({
  address: env.UPGRADE_HANDLER_ADDRESS,
  abi: upgradeHandlerAbi,
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

export async function getUpgradeStartedEvents(
  params: { fromBlock: bigint, toBlock: bigint }
) {
  const blocksInADay = BigInt(Math.floor((24 * 60 * 60) / EthereumConfig.l1.blockTime));

  const calls = []
  let currentFromBlock = params.fromBlock;
  while ((currentFromBlock + blocksInADay) < params.toBlock) {
    calls.push(upgradeHandler.getEvents.UpgradeStarted(undefined, {
      fromBlock: currentFromBlock,
      toBlock: currentFromBlock + blocksInADay - 1n,
    }))
    currentFromBlock += blocksInADay;
  }
  calls.push(upgradeHandler.getEvents.UpgradeStarted(undefined, {
    fromBlock: currentFromBlock,
    toBlock: "latest",
  }))

  return Promise.all(calls).then(lists => lists.flat() );
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
