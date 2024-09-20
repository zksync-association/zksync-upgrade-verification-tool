import { isAddressEqual, type Address } from "viem";
import { guardianMembers, withGuardiansAddress } from "./ethereum-l1/contracts/guardians";
import {
  securityCouncilMembers,
  withSecurityCouncilAddress,
} from "./ethereum-l1/contracts/security-council";
import {
  withEmergencyUpgradeBoardAddress,
  zkFoundationAddress,
} from "./ethereum-l1/contracts/emergency-upgrade-board";
import { UserRoleEnum, type UserRole } from "@/common/user-role-schema";

export async function getUserAuthRole(address: Address): Promise<UserRole> {
  const [guardianAddresses, scAddresses, zkFoundationAddr] = await Promise.all([
    withGuardiansAddress(guardianMembers),
    withSecurityCouncilAddress(securityCouncilMembers),
    withEmergencyUpgradeBoardAddress(zkFoundationAddress),
  ]);

  if (guardianAddresses.includes(address)) {
    return UserRoleEnum.enum.guardian;
  }

  if (scAddresses.includes(address)) {
    return UserRoleEnum.enum.securityCouncil;
  }

  if (isAddressEqual(address, zkFoundationAddr)) {
    return UserRoleEnum.enum.zkFoundation;
  }

  return UserRoleEnum.enum.visitor;
}
