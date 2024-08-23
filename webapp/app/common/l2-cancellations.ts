import type { Address, Hex } from "viem";

export function getL2CancellationSignatureArgs({
  proposal,
  l2GovernorAddress,
  l2GasLimit,
  l2GasPerPubdataByteLimit,
  txMintValue,
  refundRecipient,
}: {
  proposal: {
    externalId: Hex;
    nonce: number;
  };
  l2GovernorAddress: Address;
  l2GasLimit: bigint;
  l2GasPerPubdataByteLimit: bigint;
  txMintValue: bigint;
  refundRecipient: Address;
}) {
  const message = {
    l2ProposalId: proposal.externalId,
    l2GovernorAddress,
    l2GasLimit,
    l2GasPerPubdataByteLimit,
    refundRecipient,
    txMintValue,
    nonce: proposal.nonce,
  };

  const types = [
    {
      name: "l2ProposalId",
      type: "uint256",
    },
    {
      name: "l2GovernorAddress",
      type: "address",
    },
    {
      name: "l2GasLimit",
      type: "uint256",
    },
    {
      name: "l2GasPerPubdataByteLimit",
      type: "uint256",
    },
    {
      name: "refundRecipient",
      type: "address",
    },
    {
      name: "txMintValue",
      type: "uint256",
    },
    {
      name: "nonce",
      type: "uint256",
    },
  ];

  return { message, types };
}
