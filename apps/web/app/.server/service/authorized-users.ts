import { l1Rpc } from "@/.server/service/clients";
import {
  emergencyBoardAbi,
  guardiansAbi,
  scAbi,
  upgradeHandlerAbi,
} from "@/.server/service/contract-abis";
import { hexSchema } from "@/common/basic-schemas";
import { type UserRole, UserRoleSchema } from "@/common/user-role-schema";
import { env } from "@config/env.server";
import { type Hex, isAddressEqual } from "viem";
import { z } from "zod";

const upgradeHandlerAddress = env.UPGRADE_HANDLER_ADDRESS;

const range = (l: number): number[] => new Array(l).fill(0).map((_, i) => i);

export async function guardiansAddress(): Promise<Hex> {
  return l1Rpc.contractRead(upgradeHandlerAddress, "guardians", upgradeHandlerAbi.raw, hexSchema);
}

export async function emergencyBoardAddress(): Promise<Hex> {
  return l1Rpc.contractRead(
    upgradeHandlerAddress,
    "emergencyUpgradeBoard",
    upgradeHandlerAbi.raw,
    hexSchema
  );
}

export async function councilAddress(): Promise<Hex> {
  return l1Rpc.contractRead(
    upgradeHandlerAddress,
    "securityCouncil",
    upgradeHandlerAbi.raw,
    hexSchema
  );
}

export async function zkFoundationAddress(): Promise<Hex> {
  return await l1Rpc.contractRead(
    await emergencyBoardAddress(),
    "ZK_FOUNDATION_SAFE",
    emergencyBoardAbi.raw,
    hexSchema
  );
}

export async function guardianMembers(): Promise<Hex[]> {
  return Promise.all(
    range(8).map(async (i) =>
      l1Rpc.contractRead(await guardiansAddress(), "members", guardiansAbi.raw, z.any(), [i])
    )
  );
}

export async function councilMembers(): Promise<Hex[]> {
  return Promise.all(
    range(12).map(async (i) =>
      l1Rpc.contractRead(await councilAddress(), "members", scAbi.raw, z.any(), [i])
    )
  );
}

export async function getUserAuthRole(address: Hex): Promise<UserRole> {
  const [guardianAddresses, scAddresses] = await Promise.all([guardianMembers(), councilMembers()]);

  if (guardianAddresses.includes(address)) {
    return UserRoleSchema.enum.guardian;
  }

  if (scAddresses.includes(address)) {
    return UserRoleSchema.enum.securityCouncil;
  }
  if (isAddressEqual(address, await zkFoundationAddress())) {
    return UserRoleSchema.enum.zkFoundation;
  }

  return UserRoleSchema.enum.visitor;
}
