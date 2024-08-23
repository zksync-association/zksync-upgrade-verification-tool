import { getL2CancellationSignatureArgs } from "@/common/l2-cancellations";
import type { SignAction } from "@/common/sign-action";
import { Button } from "@/components/ui/button";
import type { action } from "@/routes/app/proposals/$id/_route";
import { useFetcher } from "@remix-run/react";
import { useEffect } from "react";
import { toast } from "react-hot-toast";
import { type Address, type Hash, type Hex, hexToBigInt } from "viem";
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
    nonce: number;
  };
  l2GovernorAddress: Address;
  l2GasLimit: Hex;
  l2GasPerPubdataByteLimit: Hex;
  txMintValue: Hex;
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
  const {
    signTypedData,
    isPending,
    isSuccess,
    isError,
    error: errorData,
    data: signature,
  } = useSignTypedData();
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
      console.error(errorData);
      toast.error("Failed to sign", { id: "sign_button" });
    }
  }, [loading, success, error, errorData]);

  const { message, types } = getL2CancellationSignatureArgs({
    proposal,
    l2GovernorAddress,
    l2GasLimit: hexToBigInt(l2GasLimit),
    l2GasPerPubdataByteLimit: hexToBigInt(l2GasPerPubdataByteLimit),
    txMintValue: hexToBigInt(txMintValue),
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
