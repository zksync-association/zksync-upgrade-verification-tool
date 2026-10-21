import type { Address, Hex } from "viem";

export const CHAIN_UPGRADE = {
  l1ChainId: 11155111,
  defaultChainId: "312",
  handler: "0xD7B653c373aa9585141223d244DA857b10c92d85" as Address,
  bridgehub: "0xF49C690785b9fE5261d786237348A66896e2F477" as Address,
  ctm: "0x4d058d138F477c4b97B3D762f923811b20220078" as Address,
  adminCodeHash: "0xac32f21a7e9bc1ad85232409aea70bace46c515e3ba88dba2f72c89e3c0f97b1" as Hex,
  versionShift: 32n,
  versionMask: 0xffffn,
  modernAdminMinor: 31n,
  walletGasPadding: 500_000n,
  gasMarginNumerator: 150n,
  gasMarginDenominator: 100n,
  refreshMs: 12_000,
  timeoutMs: 30_000,
} as const;
export function protocolVersionLabel(_value: string) {
  const value = BigInt(_value);
  return `v${value >> (CHAIN_UPGRADE.versionShift * 2n)}.${(value >> CHAIN_UPGRADE.versionShift) & CHAIN_UPGRADE.versionMask}.${value & ((1n << CHAIN_UPGRADE.versionShift) - 1n)}`;
}
export type ChainUpgradeState = {
  chainId: string;
  l1ChainId: number;
  block: string;
  clock: string;
  diamond: Address;
  ctm: Address;
  admin: Address;
  owner: Address;
  notifier: Address;
  currentVersion: string;
  targetVersion: string;
  completed: boolean;
  timestamp: string;
  cutHash: Hex;
  cutBlock: string;
  cutSourceTransaction: Hex | null;
};
export type ChainUpgradePlan = {
  action: "timestamp" | "execute";
  chainId: number;
  owner: Address;
  to: Address;
  data: Hex;
  value: "0";
  gasLimit: string;
  timestamp: string;
  state: ChainUpgradeState;
  previousSubmission?: { hash: Hex; status: "pending" | "reverted" | "confirmed" };
};
