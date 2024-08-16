import type { freezeProposalsTable } from "@/.server/db/schema";
import { getFreezeProposalSignatureArgs } from "@/common/freeze-proposal";
import type { SignAction } from "@/common/sign-action";
import { Button } from "@/components/ui/button";
import type { action } from "@/routes/app/proposals/$id/_route";
import { useFetcher } from "@remix-run/react";
import type { InferSelectModel } from "drizzle-orm";
import { useEffect } from "react";
import { toast } from "react-hot-toast";
import type { Hex } from "viem";
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
  proposal: InferSelectModel<typeof freezeProposalsTable>;
};

export default function SignButton({
  children,
  contractData,
  disabled,
  proposal,
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

  const { message, types } = getFreezeProposalSignatureArgs(proposal);

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
