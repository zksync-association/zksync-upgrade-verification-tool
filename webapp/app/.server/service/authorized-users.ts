import {
  guardiansAbi,
  scAbi,
  upgradeHandlerAbi,
} from "@/.server/service/protocol-upgrade-handler-abi";
import { env } from "@config/env.server";
import { RpcClient, zodHex } from "validate-cli";
import type { Hex } from "viem";
import { z } from "zod";

const rpc = new RpcClient(env.L1_RPC_URL_FOR_UPGRADES);
const upgradeHandlerAddress = env.UPGRADE_HANDLER_ADDRESS;

const range = (l: number): number[] => new Array(l).fill(0).map((_, i) => i);

export const UserRole = z.enum(["guardian", "securityCouncil"]);
export type UserRole = z.infer<typeof UserRole>;

export async function isUserAuthorized(address: Hex) {
  const [guardiansAddr, securityCouncilAddr] = await Promise.all([
    rpc.contractRead(upgradeHandlerAddress, "guardians", upgradeHandlerAbi.raw, zodHex),
    rpc.contractRead(upgradeHandlerAddress, "securityCouncil", upgradeHandlerAbi.raw, zodHex),
  ]);

  const [guardianMembers, scMembers] = await Promise.all([
    Promise.all(
      range(8).map(async (i) =>
        rpc.contractRead(guardiansAddr, "members", guardiansAbi.raw, z.any(), [i])
      )
    ),
    Promise.all(
      range(12).map((i) =>
        rpc.contractRead(securityCouncilAddr, "members", scAbi.raw, z.any(), [i])
      )
    ),
  ]);

  const isGuardian = guardianMembers.includes(address);
  const isSecurityCouncil = scMembers.includes(address);

  if (isGuardian || isSecurityCouncil) {
    return {
      authorized: true,
      role: isGuardian ? UserRole.enum.guardian : UserRole.enum.securityCouncil,
    } as const;
  }

  return {
    authorized: false,
    role: null,
  } as const;
}
