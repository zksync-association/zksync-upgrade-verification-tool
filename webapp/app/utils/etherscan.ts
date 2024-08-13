import type { Hex } from "viem";
import { EthNetwork, EthNetworkEnum } from "@/common/eth-network-enum";

const URLS = {
  [EthNetworkEnum.enum.mainnet]: "https://etherscan.io",
  [EthNetworkEnum.enum.sepolia]: "https://sepolia.etherscan.io",
  [EthNetworkEnum.enum.local]: "https://sepolia.etherscan.io",
}

export function getTransactionUrl(transactionHash: Hex, network: EthNetwork) {
  return `${URLS[network]}/tx/${transactionHash}`;
}
