import { getContract, type Address } from "viem";
import { l1Rpc } from "../client";
import { emergencyUpgradeBoardAbi } from "@/utils/contract-abis";
import { emergencyUpgradeBoardAddress } from "./protocol-upgrade-handler";

const emergencyUpgradeBoard = (address: Address) =>
  getContract({
    address,
    abi: emergencyUpgradeBoardAbi,
    client: l1Rpc,
  });

export async function zkFoundationAddress(emergencyUpgradeBoardAddress?: Address) {
  const address = await emergencyUpgradeBoardAddressOrDefault(emergencyUpgradeBoardAddress);
  return emergencyUpgradeBoard(address).read.ZK_FOUNDATION_SAFE();
}

async function emergencyUpgradeBoardAddressOrDefault(address?: Address) {
  return address ?? (await emergencyUpgradeBoardAddress());
}
