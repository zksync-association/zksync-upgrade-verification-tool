import { z } from "zod";
import { type Hex, toFunctionSelector } from "viem";

export const ETHERSCAN_ENDPOINTS = {
  mainnet: "https://api.etherscan.io/api",
  sepolia: "https://api-sepolia.etherscan.io/api",
} as const;

export const ERA_BLOCK_EXPLORER_ENDPOINTS = {
  mainnet: "https://block-explorer-api.mainnet.zksync.io/api",
  sepolia: "https://block-explorer-api.sepolia.zksync.dev/api",
} as const;

export const DIAMOND_ADDRS: Record<Network, Hex> = {
  mainnet: "0x32400084c286cf3e17e7b677ea9583e60a000324",
  sepolia: "0x9a6de0f62aa270a8bcb1e2610078650d539b1ef9",
};

export const NET_VERSIONS = {
  mainnet: "1",
  sepolia: "11155111",
};

export const NetworkSchema = z.enum(["mainnet", "sepolia"]);

export type Network = z.infer<typeof NetworkSchema>;

export const ADDRESS_ZERO = `0x${"0".repeat(40)}`;
// export const ZERO_U256 = `0x${"0".repeat(64)}`;
export const OPEN_ZEP_PROXY_IMPL_SLOT =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";


const UPGRADE_FUNCTION_ABI_ITEM = {
  inputs: [{
    components: [{
      components: [{ internalType: "uint256", name: "txType", type: "uint256" }, {
        internalType: "uint256",
        name: "from",
        type: "uint256"
      }, { internalType: "uint256", name: "to", type: "uint256" }, {
        internalType: "uint256",
        name: "gasLimit",
        type: "uint256"
      }, {
        internalType: "uint256",
        name: "gasPerPubdataByteLimit",
        type: "uint256"
      }, { internalType: "uint256", name: "maxFeePerGas", type: "uint256" }, {
        internalType: "uint256",
        name: "maxPriorityFeePerGas",
        type: "uint256"
      }, { internalType: "uint256", name: "paymaster", type: "uint256" }, {
        internalType: "uint256",
        name: "nonce",
        type: "uint256"
      }, { internalType: "uint256", name: "value", type: "uint256" }, {
        internalType: "uint256[4]",
        name: "reserved",
        type: "uint256[4]"
      }, { internalType: "bytes", name: "data", type: "bytes" }, {
        internalType: "bytes",
        name: "signature",
        type: "bytes"
      }, { internalType: "uint256[]", name: "factoryDeps", type: "uint256[]" }, {
        internalType: "bytes",
        name: "paymasterInput",
        type: "bytes"
      }, { internalType: "bytes", name: "reservedDynamic", type: "bytes" }],
      internalType: "struct L2CanonicalTransaction",
      name: "l2ProtocolUpgradeTx",
      type: "tuple"
    }, { internalType: "bytes[]", name: "factoryDeps", type: "bytes[]" }, {
      internalType: "bytes32",
      name: "bootloaderHash",
      type: "bytes32"
    }, { internalType: "bytes32", name: "defaultAccountHash", type: "bytes32" }, {
      internalType: "address",
      name: "verifier",
      type: "address"
    }, {
      components: [{
        internalType: "bytes32",
        name: "recursionNodeLevelVkHash",
        type: "bytes32"
      }, {
        internalType: "bytes32",
        name: "recursionLeafLevelVkHash",
        type: "bytes32"
      }, { internalType: "bytes32", name: "recursionCircuitsSetVksHash", type: "bytes32" }],
      internalType: "struct VerifierParams",
      name: "verifierParams",
      type: "tuple"
    }, { internalType: "bytes", name: "l1ContractsUpgradeCalldata", type: "bytes" }, {
      internalType: "bytes",
      name: "postUpgradeCalldata",
      type: "bytes"
    }, { internalType: "uint256", name: "upgradeTimestamp", type: "uint256" }, {
      internalType: "uint256",
      name: "newProtocolVersion",
      type: "uint256"
    }], internalType: "struct ProposedUpgrade", name: "_proposedUpgrade", type: "tuple"
  }],
  name: "upgrade",
  outputs: [{ internalType: "bytes32", name: "", type: "bytes32" }],
  stateMutability: "nonpayable",
  type: "function"
} as const


export const UPGRADE_FN_SELECTOR: Hex = toFunctionSelector(UPGRADE_FUNCTION_ABI_ITEM);

