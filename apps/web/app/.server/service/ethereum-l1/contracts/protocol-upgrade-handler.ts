import { env } from "@config/env.server";
import { getContract, type Hex } from "viem";

import { l1Rpc } from "../client";
import { upgradeHandlerAbi } from "@/utils/contract-abis";

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
  params: Parameters<typeof upgradeHandler.getEvents.UpgradeStarted>[1]
) {
  return upgradeHandler.getEvents.UpgradeStarted(undefined, params);
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
