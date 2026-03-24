import { getContract, type Address } from "viem";
import { l1Rpc } from "../client";
import { stateTransitionManagerAbi } from "@/utils/reinforce-abis";

export function stateTransitionManagerContract(address: Address) {
  return getContract({
    address,
    abi: stateTransitionManagerAbi,
    client: l1Rpc,
  });
}

export async function getAllHyperchainChainIDs(stmAddress: Address): Promise<bigint[]> {
  const contract = stateTransitionManagerContract(stmAddress);
  try {
    return [...(await contract.read.getAllHyperchainChainIDs())];
  } catch {
    // STM may not be deployed in local/test environments
    return [];
  }
}
