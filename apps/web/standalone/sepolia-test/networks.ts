// app/common/networks.ts for the Sepolia test build: the same module, with Sepolia's trust anchors
// replaced by the test deployment's (deploy.ts writes deployment.json; vite.config.ts inlines it).
// The L2 side stays ZKsync Era Sepolia's: its RPC and governors.
import type { Address, Hex } from "viem";
import { NETWORKS } from "../../app/common/networks";

export * from "../../app/common/networks";

declare const __SEPOLIA_TEST_DEPLOYMENT__: {
  handlerDeployBlock: number;
  contracts: { protocolUpgradeHandler: Address };
  codeHashes: {
    securityCouncil: Hex;
    guardians: Hex;
    emergencyUpgradeBoard: Hex;
    safeProxy: Hex;
  };
};

const deployment = __SEPOLIA_TEST_DEPLOYMENT__;
const pinned = NETWORKS[11155111];
const handler = deployment.contracts.protocolUpgradeHandler;
const deployBlock = BigInt(deployment.handlerDeployBlock);

NETWORKS[11155111] = {
  ...pinned,
  label: "Sepolia · test deployment",
  upgradeHandler: handler,
  upgradeHandlerDeployBlock: deployBlock,
  // TestnetProtocolUpgradeHandler: no legal veto period, no delay.
  standardLegalVetoDays: 0,
  upgradeDelayDays: 0,
  logCanary: pinned.logCanary && {
    ...pinned.logCanary,
    address: handler,
    blockNumber: deployBlock,
  },
  // Read from the deployment (its Safes are Safe 1.3.0, as on mainnet).
  codePins: {
    ...deployment.codeHashes,
    safeSingleton: "0xd9Db270c1B5E3Bd161E8c8503c55cEABeE709552",
    safeFallbackHandler: "0xf48f2B2d2a534e402487b3ee7C18c33Aec0Fe5e4",
  },
};
