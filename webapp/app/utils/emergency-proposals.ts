import { type AbiParameter, type Hash, encodeAbiParameters, keccak256 } from "viem";

type Call = {
  target: Hash;
  value: bigint;
  data: Hash;
};

type UpgradeProposal = {
  calls: Call[];
  executor: Hash;
  salt: Hash;
};

export const calculateUpgradeProposalHash = (calls: Call[], salt: Hash, executorAddress: Hash) => {
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

// TODO: Replace with derive fn
export const EMERGENCY_BOARD = "0xee4a55397e9d6f4f222df2b9aa0c2ae8a69e8fa4";
