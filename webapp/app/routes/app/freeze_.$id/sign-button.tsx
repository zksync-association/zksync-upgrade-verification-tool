import type { Action, FreezeProposalsType } from "@/.server/db/schema";
import { Button } from "@/components/ui/button";
import type { action } from "@/routes/app/proposals/$id/_route";
import { useFetcher } from "@remix-run/react";
import { useEffect } from "react";
import { toast } from "react-hot-toast";
import type { Hex } from "viem";
import { useChains, useSignTypedData } from "wagmi";

type ContractData = {
  name: string;
  address: Hex;
  actionName: Action;
};

type SignButtonProps = {
  proposalId: number;
  nonce: bigint;
  validUntil: bigint;
  type: FreezeProposalsType;
  softFreezeThreshold?: bigint;
  contractData: ContractData;
  children?: React.ReactNode;
  disabled?: boolean;
};

export default function SignButton({
  children,
  contractData,
  disabled,
  nonce,
  type,
  validUntil,
  softFreezeThreshold,
  proposalId,
}: SignButtonProps) {
  const { signTypedData, isPending, isSuccess, isError, data: signature } = useSignTypedData();
  const [chain] = useChains();
  const fetcher = useFetcher<typeof action>();

  useEffect(() => {
    if (isSuccess) {
      fetcher.submit(
        { signature, proposalId, action: contractData.actionName },
        { method: "POST" }
      );
    }
  }, [isSuccess, fetcher.submit, proposalId, signature, contractData.actionName]);

  const loading = isPending || fetcher.state === "submitting" || fetcher.state === "loading";
  const success = isSuccess && fetcher.state === "idle" && fetcher.data?.ok;
  const error = isError;

  useEffect(() => {
    if (loading) {
      toast.loading("Signing...", { id: "sign_button" });
    }
    if (success) {
      toast.success("Signed successfully", { id: "sign_button" });
    }
    if (error) {
      toast.error("Failed to sign", { id: "sign_button" });
    }
  }, [loading, success, error]);

  let message = {};
  if (type === "SET_SOFT_FREEZE_THRESHOLD") {
    message = {
      threshold: softFreezeThreshold,
      nonce,
      validUntil,
    };
  } else {
    message = {
      nonce,
      validUntil,
    };
  }

  let types = {};
  if (type === "SET_SOFT_FREEZE_THRESHOLD") {
    types = [
      {
        name: "threshold",
        type: "uint256",
      },
      {
        name: "nonce",
        type: "uint256",
      },
      {
        name: "validUntil",
        type: "uint256",
      },
    ];
  } else {
    types = [
      {
        name: "nonce",
        type: "uint256",
      },
      {
        name: "validUntil",
        type: "uint256",
      },
    ];
  }

  function onClick() {
    signTypedData({
      domain: {
        name: contractData.name,
        version: "1",
        chainId: chain.id,
        verifyingContract: contractData.address,
      },
      primaryType: contractData.actionName,
      message,
      types: {
        [contractData.actionName]: types,
      },
    });
  }

  return (
    <Button loading={loading} disabled={disabled} onClick={onClick}>
      {children}
    </Button>
  );
}
