import { getContract, type Address } from "viem";
import { l1Rpc } from "../client";
import { emergencyUpgradeBoardAddress } from "./protocol-upgrade-handler";
import { emergencyUpgradeBoardAbi } from "@/utils/contract-abis";

const emergencyUpgradeBoard = (address: Address) =>
  getContract({
    address,
    abi: emergencyUpgradeBoardAbi,
    client: l1Rpc,
  });

export async function withEmergencyUpgradeBoardAddress<T>(
  fn: (emergencyUpgradeBoardAddress: Address) => Promise<T>
) {
  const emergencyUpgradeBoardAddr = await emergencyUpgradeBoardAddress();
  return fn(emergencyUpgradeBoardAddr);
}

export async function zkFoundationAddress(emergencyUpgradeBoardAddress: Address) {
  return emergencyUpgradeBoard(emergencyUpgradeBoardAddress).read.ZK_FOUNDATION_SAFE();
}
