import BasicSignButton, { fetcherToStatuses } from "@/components/basic-sign-button";
import type { Hex } from "viem";
import { emergencyUpgradeActionForRole, type UserRole } from "@/common/user-role-schema";
import { useCallback } from "react";
import { useFetcher } from "@remix-run/react";
import type { action } from "@/routes/app/emergency/$id/_route";

export type EmergencySignButtonProps = {
  proposalId: Hex;
  contractAddress: Hex;
  role: UserRole;
  disabled: boolean;
};

export function EmergencySignButton({
  proposalId,
  contractAddress,
  role,
  disabled,
}: EmergencySignButtonProps) {
  const contractName = "EmergencyUpgradeBoard";
  const actionName = emergencyUpgradeActionForRole(role);

  const fetcher = useFetcher<typeof action>();

  const submitSignature = useCallback(
    (signature: Hex) => {
      fetcher.submit({ intent: "newSignature", signature, proposalId }, { method: "POST" });
    },
    [fetcher, proposalId]
  );

  const [onSignatureCreatedStatus, onSignatureCreatedResult] = fetcherToStatuses(fetcher);

  return (
    <BasicSignButton
      contractData={{
        address: contractAddress,
        name: contractName,
      }}
      onSignatureCreated={submitSignature}
      onSignatureCreatedStatus={onSignatureCreatedStatus}
      onSignatureCreatedResult={onSignatureCreatedResult}
      primaryType={actionName}
      types={{
        [actionName]: [
          {
            name: "id",
            type: "bytes32",
          },
        ],
      }}
      message={{
        id: proposalId,
      }}
      disabled={disabled}
      dataTestId={"approve-button"}
    >
      Approve emergency upgrade
    </BasicSignButton>
  );
}
