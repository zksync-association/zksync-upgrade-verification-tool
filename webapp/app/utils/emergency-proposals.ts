import { type AbiParameter, type Hex, encodeAbiParameters, keccak256 } from "viem";

type Call = {
  target: Hex;
  value: bigint;
  data: Hex;
};

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

