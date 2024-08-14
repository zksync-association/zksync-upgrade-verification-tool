import type { Call } from "@/common/calls";
import { type AbiParameter, type Hex, encodeAbiParameters, keccak256 } from "viem";

type UpgradeProposal = {
  calls: Call[];
  executor: Hex;
  salt: Hex;
};

export const calculateUpgradeProposalHash = (calls: Call[], salt: Hex, executorAddress: Hex) => {
  const upgradeProposal: UpgradeProposal = {
    calls,
    executor: executorAddress,
    salt,
  };

  const upgradeProposalAbi: AbiParameter[] = [
    {
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
    },
  ];

  const encodedProposal = encodeAbiParameters(upgradeProposalAbi, [upgradeProposal]);
  return keccak256(encodedProposal);
};

export const SEC_COUNCIL_THRESHOLD = 9;
export const GUARDIANS_COUNCIL_THRESHOLD = 5;
export const ZK_FOUNDATION_THRESHOLD = 1;
