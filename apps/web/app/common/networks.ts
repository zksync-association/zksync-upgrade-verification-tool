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
// - L2 governor log blocks (one eth_getLogs over the three governors from Era genesis, 2026-10-06):
//   the first ProposalCreated/Executed/Canceled log, and the first log of any kind (deployment).
// - Sepolia ProtocolUpgradeHandler 0x7444…: apps/web/docs (removed). It is the only Sepolia handler
//   that still answers the handler ABI; the one listed in the docs (0xe3a6…) is a proxy whose
//   implementation no longer has handler functions. Override with UPGRADE_HANDLER_ADDRESS.
export type NetworkName = "mainnet" | "sepolia" | "local";

// keccak256 of runtime code the app relies on (read on mainnet at block 26,141,196). Only while it
// matches is what that code never writes after its constructor kept per process, and the verdict
// fast path used (the ZK Foundation Safe's: while its singleton and fallback handler match too).
export type CodePins = {
  securityCouncil: Hex;
  guardians: Hex;
  emergencyUpgradeBoard: Hex;
  /** Safe 1.3.0 proxy runtime code (every member Safe's and the ZK Foundation's). */
  safeProxy: Hex;
  /** Safe 1.3.0 singleton (slot 0 of the proxy) and CompatibilityFallbackHandler 1.3.0. */
  safeSingleton: Address;
  safeFallbackHandler: Address;
};

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
  // Where the L2 governors' log index starts (else their deployment). Both null: no index (every
  // governor is read on demand).
  l2GovernorsFirstLogBlock: bigint | null;
  l2GovernorsDeployBlock: bigint | null;
  explorerUrl: string | null;
  l2ExplorerUrl: string | null;
  tallyUrl: string | null;
  standardLegalVetoDays: number;
  blockTimeSeconds: number;
  // A log that must exist on any RPC with full log history. If an RPC returns nothing for it,
  // the app says so instead of silently showing an incomplete list.
  logCanary: { address: Address; topic0: Hex; blockNumber: bigint } | null;
  codePins: CodePins | null;
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
    l2GovernorsFirstLogBlock: 49_077_771n,
    l2GovernorsDeployBlock: 41_196_850n,
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
    codePins: {
      securityCouncil: "0x07a16e42a0b772364b7bd47f916d4dde6ac2106132cd0a6023a7284a9b5c1e63",
      guardians: "0xa169d7c0fe3a79ef97995412a52a2821b95065574c263832f29fd1dd623eba38",
      emergencyUpgradeBoard: "0x9999af49fff31340fdc41580fd792d782708cdd7749dbd3b6c6148080354c7a3",
      safeProxy: "0xb89c1b3bdf2cf8827818646bce9a8f6e372885f8c55e5c07acbd307cb133b000",
      safeSingleton: "0xd9Db270c1B5E3Bd161E8c8503c55cEABeE709552",
      safeFallbackHandler: "0xf48f2B2d2a534e402487b3ee7C18c33Aec0Fe5e4",
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
    l2GovernorsFirstLogBlock: 3_590_083n,
    l2GovernorsDeployBlock: 3_584_343n,
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
    codePins: null,
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
    l2GovernorsFirstLogBlock: null,
    l2GovernorsDeployBlock: null,
    explorerUrl: null,
    l2ExplorerUrl: null,
    tallyUrl: null,
    standardLegalVetoDays: 3,
    blockTimeSeconds: 12,
    logCanary: null,
    codePins: null,
  };
}

export function knownNetwork(chainId: number): NetworkConfig | null {
  return (NETWORKS as Record<number, NetworkConfig>)[chainId] ?? null;
}
