import { councilMembers, guardianMembers } from "@/.server/service/contracts";
import type { Hex } from "viem";
import { z } from "zod";

export const UserRole = z.enum(["guardian", "securityCouncil", "visitor"]);

export type UserRole = z.infer<typeof UserRole>;

export async function getUserAuthRole(address: Hex): Promise<UserRole> {
  const [guardianAddresses, scAddresses] = await Promise.all([guardianMembers(), councilMembers()]);

  if (guardianAddresses.includes(address)) {
    return UserRole.enum.guardian;
  }

  if (scAddresses.includes(address)) {
    return UserRole.enum.securityCouncil;
  }

  return UserRole.enum.visitor;
}
