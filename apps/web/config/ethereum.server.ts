import type { EthNetwork } from "@/common/eth-network-enum";
import { env } from "@config/env.server";
import type { Network } from "@repo/common/ethereum";
import type { Hex } from "viem";

let EthereumConfig: {
  readonly network: EthNetwork;
  readonly l1: {
    readonly rpcUrl: string;
    readonly chainId: number;
    readonly blockTime: number;
  };
  readonly l2: {
    readonly rpcUrl: string;
    readonly blockTime: number;
  };
  readonly legacyClientNetwork: Network;
  readonly etherscanBaseUrl: string;
  readonly getTransactionUrl: (transactionHash: Hex) => string;
  readonly standardProposalVetoPeriodDays: number;
  readonly supportsLogProof: boolean;
};

const SEPOLIA_ETHERSCAN_BASE_URL = "https://sepolia.etherscan.io";
const MAINNET_ETHERSCAN_BASE_URL = "https://etherscan.io";

const getSepoliaTransactionUrl = (transactionHash: Hex) =>
  `${SEPOLIA_ETHERSCAN_BASE_URL}/tx/${transactionHash}`;
const getMainnetTransactionUrl = (transactionHash: Hex) =>
  `${MAINNET_ETHERSCAN_BASE_URL}/tx/${transactionHash}`;

if (env.ETH_NETWORK === "mainnet") {
  EthereumConfig = {
    network: env.ETH_NETWORK,
    legacyClientNetwork: "mainnet",
    l1: {
      rpcUrl: env.L1_RPC_URL,
      chainId: 1,
      blockTime: 12,
    },
    l2: {
      rpcUrl: env.L2_RPC_URL,
      blockTime: 1,
    },
    etherscanBaseUrl: MAINNET_ETHERSCAN_BASE_URL,
    getTransactionUrl: getMainnetTransactionUrl,
    standardProposalVetoPeriodDays: 3,
    supportsLogProof: true,
  };
} else if (env.ETH_NETWORK === "sepolia") {
  EthereumConfig = {
    network: env.ETH_NETWORK,
    legacyClientNetwork: "sepolia",
    l1: {
      rpcUrl: env.L1_RPC_URL,
      chainId: 11155111,
      blockTime: 12,
    },
    l2: {
      rpcUrl: env.L2_RPC_URL,
      blockTime: 20,
    },
    etherscanBaseUrl: SEPOLIA_ETHERSCAN_BASE_URL,
    getTransactionUrl: getSepoliaTransactionUrl,
    standardProposalVetoPeriodDays: 0,
    supportsLogProof: true,
  };
} else if (env.ETH_NETWORK === "local") {
  EthereumConfig = {
    network: env.ETH_NETWORK,
    legacyClientNetwork: "sepolia",
    l1: {
      rpcUrl: env.L1_RPC_URL,
      chainId: 11155111,
      blockTime: 12,
    },
    l2: {
      rpcUrl: env.L2_RPC_URL,
      blockTime: 1,
    },
    etherscanBaseUrl: SEPOLIA_ETHERSCAN_BASE_URL,
    getTransactionUrl: getSepoliaTransactionUrl,
    standardProposalVetoPeriodDays: 3,
    supportsLogProof: false,
  };
}

export { EthereumConfig };
