import BasicSignButton, { fetcherToStatuses } from "@/components/basic-sign-button";
import type { Hex } from "viem";
import { useCallback } from "react";
import {
  buildSignatureMessage,
  ethTypesForFreezeKind,
  freezeActionFromType,
  type FreezeProposalsType,
} from "@/common/freeze-proposal-type";
import { useFetcher } from "@remix-run/react";
import type { action } from "@/routes/app/freeze/$id/_route";

type SignFreezeButtonProps = {
  proposalId: number;
  nonce: string;
  contractAddress: Hex;
  freezeType: FreezeProposalsType;
  softFreezeThreshold: number | null;
  validUntil: Date;
  disabled: boolean;
};

export function SignFreezeButton({
  proposalId,
  nonce,
  contractAddress,
  freezeType,
  softFreezeThreshold,
  validUntil,
  disabled,
}: SignFreezeButtonProps) {
  const fetcher = useFetcher<typeof action>();

  const actionName = freezeActionFromType(freezeType);
  const saveSignature = useCallback(
    (signature: Hex) => {
      fetcher.submit({ signature, proposalId, action: actionName }, { method: "POST" });
    },
    [fetcher, proposalId, actionName]
  );
  const types = ethTypesForFreezeKind(freezeType);
  const message = buildSignatureMessage({
    type: freezeType,
    externalId: BigInt(nonce),
    softFreezeThreshold: softFreezeThreshold,
    validUntil,
  });

  const [onSignatureCreatedStatus, onSignatureCreatedResult] = fetcherToStatuses(fetcher);

  return (
    <BasicSignButton
      contractData={{
        name: "SecurityCouncil",
        address: contractAddress,
      }}
      onSignatureCreated={saveSignature}
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
