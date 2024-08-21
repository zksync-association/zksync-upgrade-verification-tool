import { getVetoL2GovernorProposalSignatureArgs } from "@/common/l2-governor-proposal";
import type { SignAction } from "@/common/sign-action";
import { Button } from "@/components/ui/button";
import type { action } from "@/routes/app/proposals/$id/_route";
import { useFetcher } from "@remix-run/react";
import { useEffect } from "react";
import { toast } from "react-hot-toast";
import type { Address, Hash, Hex } from "viem";
import { useChains, useSignTypedData } from "wagmi";

type ContractData = {
  name: string;
  address: Hex;
  actionName: SignAction;
};

type SignButtonProps = {
  contractData: ContractData;
  children?: React.ReactNode;
  disabled?: boolean;
  proposal: {
    id: number;
    externalId: Hash;
    nonce: bigint;
  };
  l2GovernorAddress: Address;
  l2GasLimit: bigint;
  l2GasPerPubdataByteLimit: bigint;
  txMintValue: bigint;
  refundRecipient: Address;
};

export default function SignButton({
  children,
  contractData,
  disabled,
  proposal,
  l2GovernorAddress,
  l2GasLimit,
  l2GasPerPubdataByteLimit,
  txMintValue,
  refundRecipient,
}: SignButtonProps) {
  const { signTypedData, isPending, isSuccess, isError, data: signature } = useSignTypedData();
  const [chain] = useChains();
  const fetcher = useFetcher<typeof action>();

  useEffect(() => {
    if (isSuccess) {
      fetcher.submit(
        { signature, proposalId: proposal.id, action: contractData.actionName },
        { method: "POST" }
      );
    }
  }, [isSuccess, fetcher.submit, proposal.id, signature, contractData.actionName]);

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

  const { message, types } = getVetoL2GovernorProposalSignatureArgs({
    proposal,
    l2GovernorAddress,
    l2GasLimit,
    l2GasPerPubdataByteLimit,
    txMintValue,
    refundRecipient,
  });

  function onClick() {
    const data = {
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
    };
    signTypedData(data);
  }

  return (
    <Button loading={loading} disabled={disabled} onClick={onClick}>
      {children}
    </Button>
  );
}
