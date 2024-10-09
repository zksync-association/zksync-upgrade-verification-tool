import BasicSignButton, { fetcherToStatuses } from "@/components/basic-sign-button";
import type { Hex } from "viem";
import { useFetcher } from "@remix-run/react";
import { useCallback } from "react";
import type { action } from "@/routes/app/proposals/$id/_route";
import { signActionEnum } from "@/common/sign-action";

export type ApproveSignButtonProps = {
  proposalId: Hex;
  contractAddress: Hex;
  disabled: boolean;
};

export function ExtendVetoButton({
  proposalId,
  contractAddress,
  disabled,
}: ApproveSignButtonProps) {
  const fetcher = useFetcher<typeof action>();

  const submitSignature = useCallback(
    (signature: Hex) => {
      fetcher.submit({ intent: "extendVeto", signature, proposalId }, { method: "POST" });
    },
    [fetcher, proposalId]
  );

  const [onSignatureCreatedStatus, onSignatureCreatedResult] = fetcherToStatuses(fetcher);

  return (
    <BasicSignButton
      message={{
        id: proposalId,
      }}
      contractData={{
        name: "Guardians",
        address: contractAddress,
      }}
      onSignatureCreated={submitSignature}
      onSignatureCreatedStatus={onSignatureCreatedStatus}
      onSignatureCreatedResult={onSignatureCreatedResult}
      disabled={disabled}
      primaryType={signActionEnum.enum.ExtendLegalVetoPeriod}
      types={{
        [signActionEnum.enum.ExtendLegalVetoPeriod]: [
          {
            name: "id",
            type: "bytes32",
          },
        ],
      }}
      dataTestId={"extend-veto-button"}
    >
      Extend Legal Veto Period
    </BasicSignButton>
  );
}
