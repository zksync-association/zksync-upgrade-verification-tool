import { isAddressEqual, type Address } from "viem";
import { guardianMembers } from "./ethereum-l1/contracts/guardians";
import { securityCouncilMembers } from "./ethereum-l1/contracts/security-council";
import { zkFoundationAddress } from "./ethereum-l1/contracts/emergency-upgrade-board";
import { UserRoleEnum, type UserRole } from "@/common/user-role-schema";
import { env } from "@config/env.server";

export async function getUserAuthRole(address: Address): Promise<UserRole> {
  const [guardianAddresses, scAddresses, zkFoundationAddr] = await Promise.all([
    guardianMembers(),
    securityCouncilMembers(),
    zkFoundationAddress(),
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

  if (env.ZK_ADMIN_ADDRESS.some((adminAddress) => isAddressEqual(address, adminAddress))) {
    return UserRoleEnum.enum.zkAdmin;
  }

  return UserRoleEnum.enum.visitor;
}
