import { guardiansAbi, scAbi, upgradeHandlerAbi, } from "@/.server/service/protocol-upgrade-handler-abi";
import { env } from "@config/env.server";
import { zodHex } from "validate-cli";
import type { Hex } from "viem";
import { z } from "zod";
import { l1RpcProposals } from "@/.server/service/clients";

const upgradeHandlerAddress = env.UPGRADE_HANDLER_ADDRESS;

const range = (l: number): number[] => new Array(l).fill(0).map((_, i) => i);

export async function guardianAddress(): Promise<Hex> {
  return l1RpcProposals.contractRead(upgradeHandlerAddress, "guardians", upgradeHandlerAbi.raw, zodHex)
}

export async function councilAddress(): Promise<Hex> {
  return l1RpcProposals.contractRead(upgradeHandlerAddress, "securityCouncil", upgradeHandlerAbi.raw, zodHex)
}

export const UserRole = z.enum(["guardian", "security_council"]);
export type UserRole = z.infer<typeof UserRole>;

export async function isUserAuthorized(address: Hex) {
  const [guardiansAddr, securityCouncilAddr] = await Promise.all([
    guardianAddress(),
    councilAddress(),
  ]);

  const [guardianMembers, scMembers] = await Promise.all([
    Promise.all(
      range(8).map(async (i) =>
        l1RpcProposals.contractRead(guardiansAddr, "members", guardiansAbi.raw, z.any(), [i])
      )
    ),
    Promise.all(
      range(12).map((i) =>
        l1RpcProposals.contractRead(securityCouncilAddr, "members", scAbi.raw, z.any(), [i])
      )
    ),
  ]);

  const isGuardian = guardianMembers.includes(address);
  const isSecurityCouncil = scMembers.includes(address);

  if (isGuardian || isSecurityCouncil) {
    return {
      authorized: true,
      role: isGuardian ? UserRole.enum.guardian : UserRole.enum.security_council,
    } as const;
  }

  return {
    authorized: false,
    role: null,
  } as const;
}
