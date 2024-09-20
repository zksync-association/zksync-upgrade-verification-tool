import { getContract, type Address } from "viem";

import { l1Rpc } from "../client";
import { securityCouncilAddress } from "./protocol-upgrade-handler";
import { securityCouncilAbi } from "@/utils/contract-abis";

const SECURITY_COUNCIL_MEMBER_COUNT = 12;

const securityCouncil = (address: Address) =>
  getContract({
    address,
    abi: securityCouncilAbi,
    client: l1Rpc,
  });

export async function withSecurityCouncilAddress<T>(
  fn: (securityCouncilAddress: Address) => Promise<T>
) {
  const securityCouncilAddr = await securityCouncilAddress();
  return fn(securityCouncilAddr);
}

export async function securityCouncilMembers(councilAddress: Address) {
  const contract = securityCouncil(councilAddress);

  const memberPromises = Array.from({ length: SECURITY_COUNCIL_MEMBER_COUNT }, (_, i) =>
    contract.read.members([BigInt(i)])
  );

  return Promise.all(memberPromises);
}

export async function securityCouncilSoftFreezeNonce(councilAddress: Address) {
  const contract = securityCouncil(councilAddress);
  return contract.read.softFreezeNonce();
}

export async function securityCouncilHardFreezeNonce(councilAddress: Address) {
  const contract = securityCouncil(councilAddress);
  return contract.read.hardFreezeNonce();
}

export async function securityCouncilSoftFreezeThresholdSettingNonce(councilAddress: Address) {
  const contract = securityCouncil(councilAddress);
  return contract.read.softFreezeThresholdSettingNonce();
}

export async function securityCouncilUnfreezeNonce(councilAddress: Address) {
  const contract = securityCouncil(councilAddress);
  return contract.read.unfreezeNonce();
}

export async function securityCouncilSoftFreezeThreshold(councilAddress: Address) {
  const contract = securityCouncil(councilAddress);
  return contract.read.softFreezeThreshold();
}

export async function securityCouncilHardFreezeThreshold(councilAddress: Address) {
  const contract = securityCouncil(councilAddress);
  return contract.read.HARD_FREEZE_THRESHOLD();
}

export async function securityCouncilSoftFreezeConservativeThreshold(councilAddress: Address) {
  const contract = securityCouncil(councilAddress);
  return contract.read.SOFT_FREEZE_CONSERVATIVE_THRESHOLD();
}

export async function securityCouncilUnfreezeThreshold(councilAddress: Address) {
  const contract = securityCouncil(councilAddress);
  return contract.read.UNFREEZE_THRESHOLD();
}
