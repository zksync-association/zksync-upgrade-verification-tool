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
  actionName: string;
};

type SignButtonProps = {
  proposalId: Hex;
  contractData: ContractData;
  children?: React.ReactNode;
  disabled?: boolean;
  postAction: string;
  intent: "extendVeto" | "approve"
};

export default function SignButton({
  children,
  proposalId,
  contractData,
  disabled,
  postAction,
  intent
}: SignButtonProps) {
  const { signTypedData, isPending, isSuccess } = useSignTypedData();
  const [chain] = useChains();
  const fetcher = useFetcher<typeof action>();

  const loading = isPending || fetcher.state === "submitting" || fetcher.state === "loading";
  const success = isSuccess && fetcher.state === "idle" && fetcher.data?.ok;

  useEffect(() => {
    if (success) {
      toast.success("Signed successfully", { id: "sign_button" });
    }
  }, [success]);

  function onClick() {
    toast.loading("Signing...", { id: "sign_button" });
    signTypedData(
      {
        domain: {
          name: contractData.name,
          version: "1",
          chainId: chain.id,
          verifyingContract: contractData.address,
        },
        primaryType: contractData.actionName,
        message: {
          id: proposalId,
        },
        types: {
          [contractData.actionName]: [
            {
              name: "id",
              type: "bytes32",
            },
          ],
        },
      },
      {
        onSuccess: (signature) => {
          fetcher.submit(
            { intent, signature, proposalId },
            { method: "POST", action: postAction }
          );
        },
        onError() {
          toast.error("Failed to sign", { id: "sign_button" });
        },
      }
    );
  }

  return (
    <Button loading={loading} disabled={disabled} onClick={onClick}>
      {children}
    </Button>
  );
}
