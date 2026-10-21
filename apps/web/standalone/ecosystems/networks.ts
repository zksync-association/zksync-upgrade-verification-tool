// app/common/networks.ts for another ecosystem's single file (README.md): the same module, with
// the L1 chain's entry replaced by the ecosystem's config (vite.config.ts inlines it), and the
// call decoder's names and L2 chain (Era's on that L1, by default) replaced by the ecosystem's.
import type { Address } from "viem";
import catalogLabels from "../../app/common/abi-catalog/labels.json";
import { ERA_CHAIN, ERA_DIAMONDS, L1_OF } from "../../app/common/calldata";
import { NETWORKS, type NetworkConfig } from "../../app/common/networks";

export * from "../../app/common/networks";

type Ecosystem = {
  network: {
    chainId: 1 | 11155111;
    label: string;
    upgradeHandler: Address;
    upgradeHandlerDeployBlock: number;
    standardLegalVetoDays: number;
    upgradeDelayDays: number;
    safeTxServiceUrl: string | null;
    safeWalletPrefix: string | null;
    explorerUrl: string | null;
    tallyUrl: string | null;
    l2: {
      chainId: number;
      rpcUrl: string;
      explorerUrl: string | null;
      diamond: Address;
      governors: { protocol: Address | null; token: Address | null; govOps: Address | null };
      governorsFirstLogBlock: number | null;
      governorsDeployBlock: number | null;
    };
    codePins: NetworkConfig["codePins"];
  };
  labels: Record<string, string>;
};

declare const __ECOSYSTEM__: Ecosystem;

const { network: n, labels } = __ECOSYSTEM__;
const pinned = NETWORKS[n.chainId];
const deployBlock = BigInt(n.upgradeHandlerDeployBlock);
const block = (b: number | null) => (b === null ? null : BigInt(b));

NETWORKS[n.chainId] = {
  ...pinned,
  label: n.label,
  upgradeHandler: n.upgradeHandler,
  upgradeHandlerDeployBlock: deployBlock,
  standardLegalVetoDays: n.standardLegalVetoDays,
  upgradeDelayDays: n.upgradeDelayDays,
  safeTxServiceUrl: n.safeTxServiceUrl,
  safeWalletPrefix: n.safeWalletPrefix,
  explorerUrl: n.explorerUrl,
  tallyUrl: n.tallyUrl,
  l2RpcUrl: n.l2.rpcUrl,
  l2ExplorerUrl: n.l2.explorerUrl,
  l2Governors: n.l2.governors,
  l2GovernorsFirstLogBlock: block(n.l2.governorsFirstLogBlock),
  l2GovernorsDeployBlock: block(n.l2.governorsDeployBlock),
  logCanary: pinned.logCanary && {
    ...pinned.logCanary,
    address: n.upgradeHandler,
    blockNumber: deployBlock,
  },
  codePins: n.codePins,
};

// The call decoder: this ecosystem's L2 behind its L1, and its contracts' names (in place of the
// L1's built-in ones, which name another ecosystem's contracts).
for (const [l2, l1] of Object.entries(L1_OF)) if (l1 === n.chainId) delete L1_OF[Number(l2)];
for (const [a, d] of Object.entries(ERA_DIAMONDS)) if (d.l1 === n.chainId) delete ERA_DIAMONDS[a];
ERA_CHAIN[n.chainId] = n.l2.chainId;
L1_OF[n.l2.chainId] = n.chainId;
ERA_DIAMONDS[n.l2.diamond.toLowerCase()] = { l1: n.chainId, l2: n.l2.chainId };
(catalogLabels as Record<string, Record<string, string>>)[String(n.chainId)] = Object.fromEntries(
  Object.entries(labels).map(([address, name]) => [address.toLowerCase(), name])
);
