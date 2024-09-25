import type { Call } from "@/common/calls";
import { type Hex, encodeAbiParameters, keccak256, hexToBigInt } from "viem";

export const upgradeStructAbi = {
  type: "tuple",
  components: [
    {
      type: "tuple[]",
      components: [
        { type: "address", name: "target" },
        { type: "uint256", name: "value" },
        { type: "bytes", name: "data" },
      ],
      name: "calls",
    },
    { type: "address", name: "executor" },
    { type: "bytes32", name: "salt" },
  ],
} as const;

export const calculateUpgradeProposalHash = (calls: Call[], salt: Hex, executorAddress: Hex) => {
  const upgradeProposal = {
    calls: calls.map((c) => ({ ...c, value: hexToBigInt(c.value) })),
    executor: executorAddress,
    salt,
  };

  const encodedProposal = encodeAbiParameters([upgradeStructAbi], [upgradeProposal]);
  return keccak256(encodedProposal);
};

export const SEC_COUNCIL_THRESHOLD = 9;
export const GUARDIANS_COUNCIL_THRESHOLD = 5;
export const ZK_FOUNDATION_THRESHOLD = 1;
