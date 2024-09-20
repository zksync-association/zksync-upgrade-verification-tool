import { getContract, type Address } from "viem";

import { l1Rpc } from "../client";
import { securityCouncilAbi } from "@/utils/contract-abis";
import { securityCouncilAddress } from "./protocol-upgrade-handler";

const SECURITY_COUNCIL_MEMBER_COUNT = 12;

const securityCouncil = (address: Address) =>
  getContract({
    address,
    abi: securityCouncilAbi,
    client: l1Rpc,
  });

export async function securityCouncilMembers(councilAddress?: Address) {
  const address = await securityCouncilAddressOrDefault(councilAddress);
  const contract = securityCouncil(address);

  const memberPromises = Array.from({ length: SECURITY_COUNCIL_MEMBER_COUNT }, (_, i) =>
    contract.read.members([BigInt(i)])
  );

  return Promise.all(memberPromises);
}

export async function securityCouncilSoftFreezeNonce(councilAddress?: Address) {
  const address = await securityCouncilAddressOrDefault(councilAddress);
  const contract = securityCouncil(address);
  return contract.read.softFreezeNonce();
}

export async function securityCouncilHardFreezeNonce(councilAddress?: Address) {
  const address = await securityCouncilAddressOrDefault(councilAddress);
  const contract = securityCouncil(address);
  return contract.read.hardFreezeNonce();
}

export async function securityCouncilSoftFreezeThresholdSettingNonce(councilAddress?: Address) {
  const address = await securityCouncilAddressOrDefault(councilAddress);
  const contract = securityCouncil(address);
  return contract.read.softFreezeThresholdSettingNonce();
}

export async function securityCouncilUnfreezeNonce(councilAddress?: Address) {
  const address = await securityCouncilAddressOrDefault(councilAddress);
  const contract = securityCouncil(address);
  return contract.read.unfreezeNonce();
}

export async function securityCouncilSoftFreezeThreshold(councilAddress?: Address) {
  const address = await securityCouncilAddressOrDefault(councilAddress);
  const contract = securityCouncil(address);
  return contract.read.softFreezeThreshold();
}

export async function securityCouncilHardFreezeThreshold(councilAddress?: Address) {
  const address = await securityCouncilAddressOrDefault(councilAddress);
  const contract = securityCouncil(address);
  return contract.read.HARD_FREEZE_THRESHOLD();
}

export async function securityCouncilSoftFreezeConservativeThreshold(councilAddress?: Address) {
  const address = await securityCouncilAddressOrDefault(councilAddress);
  const contract = securityCouncil(address);
  return contract.read.SOFT_FREEZE_CONSERVATIVE_THRESHOLD();
}

export async function securityCouncilUnfreezeThreshold(councilAddress?: Address) {
  const address = await securityCouncilAddressOrDefault(councilAddress);
  const contract = securityCouncil(address);
  return contract.read.UNFREEZE_THRESHOLD();
}

async function securityCouncilAddressOrDefault(address?: Address) {
  return address ?? (await securityCouncilAddress());
}
