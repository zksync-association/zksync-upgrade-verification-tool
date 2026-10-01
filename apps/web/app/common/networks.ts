import { type Address, type Hex, toEventSelector } from "viem";

// Trust anchors pinned per chain. Everything else (Security Council, Guardians, Emergency Upgrade
// Board, members, thresholds, nonces) is read from the ProtocolUpgradeHandler on every load, so a
// change of council is picked up without a release.
//
// Sources, checked 2026-10-01 against the chain itself:
// - Mainnet ProtocolUpgradeHandler: zksync-association brief; its ChangeSecurityCouncil(0x0 → …)
//   event at block 21788382 marks the deployment and doubles as the log-history canary.
// - L2 governors: docs.zknation.io "ZKsync Governance Contract Addresses". The protocol governor
//   is cross-checked on-chain: ZkProtocolGovernor.timelock() == ProtocolUpgradeHandler.L2_PROTOCOL_GOVERNOR.
// - Sepolia ProtocolUpgradeHandler 0x7444…: apps/web/docs (removed). It is the only Sepolia handler
//   that still answers the handler ABI; the one listed in the docs (0xe3a6…) is a proxy whose
//   implementation no longer has handler functions. Override with UPGRADE_HANDLER_ADDRESS.
export type NetworkName = "mainnet" | "sepolia" | "local";

export type NetworkConfig = {
  name: NetworkName;
  label: string;
  chainId: number;
  upgradeHandler: Address | null;
  // First block with a handler event. Log scans never start earlier.
  upgradeHandlerDeployBlock: bigint;
  safeTxServiceUrl: string | null;
  safeWalletPrefix: string | null;
  l2RpcUrl: string | null;
  l2Governors: { protocol: Address | null; token: Address | null; govOps: Address | null };
  explorerUrl: string | null;
  l2ExplorerUrl: string | null;
  tallyUrl: string | null;
  standardLegalVetoDays: number;
  blockTimeSeconds: number;
  // A log that must exist on any RPC with full log history. If an RPC returns nothing for it,
  // the app says so instead of silently showing an incomplete list.
  logCanary: { address: Address; topic0: Hex; blockNumber: bigint } | null;
};

const CHANGE_SECURITY_COUNCIL_TOPIC = toEventSelector("ChangeSecurityCouncil(address,address)");

export const NETWORKS: Record<1 | 11155111, NetworkConfig> = {
  1: {
    name: "mainnet",
    label: "Ethereum Mainnet",
    chainId: 1,
    upgradeHandler: "0xE30Dca3047B37dc7d88849dE4A4Dc07937ad5Ab3",
    upgradeHandlerDeployBlock: 21_788_382n,
    safeTxServiceUrl: "https://api.safe.global/tx-service/eth",
    safeWalletPrefix: "eth",
    l2RpcUrl: "https://mainnet.era.zksync.io",
    l2Governors: {
      protocol: "0x76705327e682F2d96943280D99464Ab61219e34f",
      token: "0xb83FF6501214ddF40C91C9565d095400f3F45746",
      govOps: "0xEEEa739a8b6fB1b8f703E23C9Be03CeeA643b160",
    },
    explorerUrl: "https://etherscan.io",
    l2ExplorerUrl: "https://explorer.zksync.io",
    tallyUrl: "https://tally.xyz/gov/zksync",
    standardLegalVetoDays: 3,
    blockTimeSeconds: 12,
    logCanary: {
      address: "0xE30Dca3047B37dc7d88849dE4A4Dc07937ad5Ab3",
      topic0: CHANGE_SECURITY_COUNCIL_TOPIC,
      blockNumber: 21_788_382n,
    },
  },
  11155111: {
    name: "sepolia",
    label: "Sepolia",
    chainId: 11155111,
    upgradeHandler: "0x7444b49E49A4AD4376a3e3c036900869575f0FBf",
    upgradeHandlerDeployBlock: 6_380_336n,
    safeTxServiceUrl: "https://api.safe.global/tx-service/sep",
    safeWalletPrefix: "sep",
    l2RpcUrl: "https://sepolia.era.zksync.dev",
    l2Governors: {
      protocol: "0x5a6862ee581b6cDb517D24f0a69237f9D900C23C",
      token: "0x98fF5B31bBa84f5Ad05a7635a436151F74aDa466",
      govOps: "0x56f6379F945e95558069acb3E945ee3480025605",
    },
    explorerUrl: "https://sepolia.etherscan.io",
    l2ExplorerUrl: "https://sepolia.explorer.zksync.io",
    tallyUrl: null,
    standardLegalVetoDays: 0,
    blockTimeSeconds: 12,
    logCanary: {
      address: "0x7444b49E49A4AD4376a3e3c036900869575f0FBf",
      topic0: CHANGE_SECURITY_COUNCIL_TOPIC,
      blockNumber: 6_380_336n,
    },
  },
};

export function localNetwork(chainId: number): NetworkConfig {
  return {
    name: "local",
    label: `Local chain ${chainId}`,
    chainId,
    upgradeHandler: null,
    upgradeHandlerDeployBlock: 0n,
    safeTxServiceUrl: null,
    safeWalletPrefix: null,
    l2RpcUrl: null,
    l2Governors: { protocol: null, token: null, govOps: null },
    explorerUrl: null,
    l2ExplorerUrl: null,
    tallyUrl: null,
    standardLegalVetoDays: 3,
    blockTimeSeconds: 12,
    logCanary: null,
  };
}

export function knownNetwork(chainId: number): NetworkConfig | null {
  return (NETWORKS as Record<number, NetworkConfig>)[chainId] ?? null;
}
