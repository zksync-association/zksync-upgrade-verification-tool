import { encodeAbiParameters, type Hex, hexToBigInt, keccak256 } from "viem";
import type { Call } from "../schemas";

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
