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
};

type EthType = {
  name: string;
  type: string;
};

type TypedMessgeTypes = Record<string, EthType[]>;

type SignButtonProps = {
  contractData: ContractData;
  children?: React.ReactNode;
  disabled?: boolean;
  onSignatureCreated: (signature: Hex) => void;
  onSignatureCreatedStatus: "iddle" | "loading";
  onSignatureCreatedResult: "none" | "success" | "error";
  types: TypedMessgeTypes;
  message: Record<string, string>;
  primaryType: string;
};

export default function BasicSignButton({
  children,
  contractData,
  disabled,
  onSignatureCreated,
  onSignatureCreatedStatus,
  onSignatureCreatedResult,
  types,
  message,
  primaryType,
}: SignButtonProps) {
  const { signTypedData, isPending, isSuccess } = useSignTypedData();
  const [chain] = useChains();

  const loading = isPending || onSignatureCreatedStatus === "loading";
  const success = isSuccess && onSignatureCreatedResult === "success";

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
        primaryType: primaryType,
        message: message,
        types: types,
      },
      {
        onSuccess: (signature) => {
          onSignatureCreated(signature);
        },
        onError(e) {
          console.error(e);
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
