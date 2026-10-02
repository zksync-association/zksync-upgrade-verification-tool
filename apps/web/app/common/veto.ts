// A Guardians veto is fully described by the values it signs, so its page URL carries all of them.
export type VetoQuery = {
  l2ProposalId: string;
  l2GovernorAddress: string;
  l2GasLimit: string;
  l2GasPerPubdataByteLimit: string;
  refundRecipient: string;
  txMintValue: string;
  nonce: string;
};

export function vetoPath(v: VetoQuery) {
  const query = new URLSearchParams({
    governor: v.l2GovernorAddress,
    l2GasLimit: v.l2GasLimit,
    l2GasPerPubdataByteLimit: v.l2GasPerPubdataByteLimit,
    refundRecipient: v.refundRecipient,
    txMintValue: v.txMintValue,
    nonce: v.nonce,
  });
  return `/app/l2-cancellations/${v.l2ProposalId}?${query}`;
}

// Defaults matching the veto Guardians executed on mainnet (nonce 0).
export const VETO_DEFAULTS = {
  l2GasLimit: "30000000",
  l2GasPerPubdataByteLimit: "800",
  txMintValue: "20000000000000000",
};
