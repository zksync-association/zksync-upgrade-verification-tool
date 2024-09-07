import BasicSignButton, { fetcherToStatuses } from "@/components/basic-sign-button";
import type { Hex } from "viem";
import {
  regularUpgradeContractNameByRole,
  standardUpgradeActionForRole,
  type UserRole,
} from "@/common/user-role-schema";
import { useFetcher } from "@remix-run/react";
import { useCallback } from "react";
import type { action } from "@/routes/app/proposals/$id/_route";

export type ApproveSignButtonProps = {
  proposalId: Hex;
  contractAddress: Hex;
  disabled: boolean;
  role: UserRole;
};

export function ApproveSignButton({
  proposalId,
  contractAddress,
  disabled,
  role,
}: ApproveSignButtonProps) {
  const actionName = standardUpgradeActionForRole(role);
  const fetcher = useFetcher<typeof action>();

  const submitSignature = useCallback(
    (signature: Hex) => {
      fetcher.submit({ intent: "approve", signature, proposalId }, { method: "POST" });
    },
    [fetcher, proposalId]
  );

  const contractName = regularUpgradeContractNameByRole(role);

  const [onSignatureCreatedStatus, onSignatureCreatedResult] = fetcherToStatuses(fetcher);

  return (
    <BasicSignButton
      message={{
        id: proposalId,
      }}
      contractData={{
        name: contractName,
        address: contractAddress,
      }}
      onSignatureCreated={submitSignature}
      onSignatureCreatedStatus={onSignatureCreatedStatus}
      onSignatureCreatedResult={onSignatureCreatedResult}
      disabled={disabled}
      primaryType={actionName}
      types={{
        [actionName]: [
          {
            name: "id",
            type: "bytes32",
          },
        ],
      }}
    >
      Approve upgrade
    </BasicSignButton>
  );
}
