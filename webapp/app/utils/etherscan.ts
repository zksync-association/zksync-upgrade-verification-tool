import { type EthNetwork, EthNetworkEnum } from "@/common/eth-network-enum";
import type { Hex } from "viem";

const URLS = {
  [EthNetworkEnum.enum.mainnet]: "https://etherscan.io",
  [EthNetworkEnum.enum.sepolia]: "https://sepolia.etherscan.io",
  [EthNetworkEnum.enum.local]: "https://sepolia.etherscan.io",
};

export function getTransactionUrl(transactionHash: Hex, network: EthNetwork) {
  return `${URLS[network]}/tx/${transactionHash}`;
}
