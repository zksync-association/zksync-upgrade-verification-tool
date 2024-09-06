import BasicSignButton from "@/components/basic-sign-button";
import { type Hex, hexToBigInt } from "viem";
import { useCallback } from "react";
import { useFetcher } from "@remix-run/react";
import type { action } from "@/routes/app/l2-cancellations/$id/_route";
import { getL2CancellationSignatureArgs } from "@/common/l2-cancellations";
import { signActionEnum } from "@/common/sign-action";

export type SignCancellationButtonProps = {
  externalId: Hex;
  nonce: number;
  contractAddress: Hex;
  proposalId: number;
  l2GovernorAddress: Hex;
  l2GasLimit: Hex;
  l2GasPerPubdataByteLimit: Hex;
  txMintValue: Hex;
  refundRecipient: Hex;
  disabled: boolean;
};

export function SignCancellationButton({
  externalId,
  nonce,
  contractAddress,
  proposalId,
  l2GovernorAddress,
  l2GasLimit,
  l2GasPerPubdataByteLimit,
  txMintValue,
  refundRecipient,
  disabled,
}: SignCancellationButtonProps) {
  const fetcher = useFetcher<typeof action>();

  const submitSignature = useCallback(
    (signature: Hex) => {
      fetcher.submit({ signature, proposalId }, { method: "POST" });
    },
    [fetcher, proposalId]
  );

  const onSignatureCreatedStatus = fetcher.state === "idle" ? "iddle" : "loading";

  const onSignatureCreatedResult = fetcher.data?.ok
    ? "success"
    : fetcher.state === "idle"
      ? "none"
      : "error";

  const { message, types } = getL2CancellationSignatureArgs({
    proposal: {
      externalId,
      nonce,
    },
    l2GovernorAddress,
    l2GasLimit: hexToBigInt(l2GasLimit),
    l2GasPerPubdataByteLimit: hexToBigInt(l2GasPerPubdataByteLimit),
    txMintValue: hexToBigInt(txMintValue),
    refundRecipient,
  });

  const actionName = signActionEnum.enum.CancelL2GovernorProposal;

  return (
    <BasicSignButton
      contractData={{
        name: "Guardians",
        address: contractAddress,
      }}
      onSignatureCreated={submitSignature}
      onSignatureCreatedStatus={onSignatureCreatedStatus}
      onSignatureCreatedResult={onSignatureCreatedResult}
      types={{
        [actionName]: types,
      }}
      message={message}
      primaryType={actionName}
      disabled={disabled}
    >
      Approve
    </BasicSignButton>
  );
}
