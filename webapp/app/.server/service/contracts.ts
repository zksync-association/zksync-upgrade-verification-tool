import { l1Rpc } from "@/.server/service/clients";
import { guardiansAbi, scAbi, upgradeHandlerAbi } from "@/.server/service/contract-abis";
import { env } from "@config/env.server";
import { zodHex } from "validate-cli";
import type { Hex } from "viem";
import { z } from "zod";

const range = (l: number): number[] => new Array(l).fill(0).map((_, i) => i);

// Guardians.sol
export async function guardiansAddress(): Promise<Hex> {
  return l1Rpc.contractRead(
    env.UPGRADE_HANDLER_ADDRESS,
    "guardians",
    upgradeHandlerAbi.raw,
    zodHex
  );
}

export async function guardianMembers(): Promise<Hex[]> {
  return Promise.all(
    range(8).map(async (i) =>
      l1Rpc.contractRead(await guardiansAddress(), "members", guardiansAbi.raw, z.any(), [i])
    )
  );
}

// SecurityCouncil.sol
export async function councilAddress(): Promise<Hex> {
  return l1Rpc.contractRead(
    env.UPGRADE_HANDLER_ADDRESS,
    "securityCouncil",
    upgradeHandlerAbi.raw,
    zodHex
  );
}

export async function councilMembers(): Promise<Hex[]> {
  return Promise.all(
    range(12).map(async (i) =>
      l1Rpc.contractRead(await councilAddress(), "members", scAbi.raw, z.any(), [i])
    )
  );
}

export async function councilSoftFreezeNonce(): Promise<bigint> {
  return l1Rpc.contractRead(await councilAddress(), "softFreezeNonce", scAbi.raw, z.bigint());
}

export async function councilHardFreezeNonce(): Promise<bigint> {
  return l1Rpc.contractRead(await councilAddress(), "hardFreezeNonce", scAbi.raw, z.bigint());
}

export async function councilSoftFreezeThresholdSettingNonce(): Promise<bigint> {
  return l1Rpc.contractRead(
    await councilAddress(),
    "softFreezeThresholdSettingNonce",
    scAbi.raw,
    z.bigint()
  );
}

export async function councilUnfreezeNonce(): Promise<bigint> {
  return l1Rpc.contractRead(await councilAddress(), "unfreezeNonce", scAbi.raw, z.bigint());
}

export async function councilSoftFreezeThreshold(): Promise<bigint> {
  return l1Rpc.contractRead(await councilAddress(), "softFreezeThreshold", scAbi.raw, z.bigint());
}

export async function councilHardFreezeThreshold(): Promise<bigint> {
  return l1Rpc.contractRead(await councilAddress(), "HARD_FREEZE_THRESHOLD", scAbi.raw, z.bigint());
}

export async function councilSetSoftFreezeThresholdThreshold(): Promise<bigint> {
  return l1Rpc.contractRead(
    await councilAddress(),
    "SOFT_FREEZE_CONSERVATIVE_THRESHOLD",
    scAbi.raw,
    z.bigint()
  );
}

export async function councilUnfreezeThreshold(): Promise<bigint> {
  return l1Rpc.contractRead(await councilAddress(), "UNFREEZE_THRESHOLD", scAbi.raw, z.bigint());
}
