import { Button } from "@/components/ui/button";
import { useEffect } from "react";
import { toast } from "react-hot-toast";
import type { Hex } from "viem";
import { useChains, useSignTypedData } from "wagmi";
import { z } from "zod";
import type { useFetcher } from "@remix-run/react";

type ContractData = {
  name: string;
  address: Hex;
};

type EthType = {
  name: string;
  type: string;
};

type TypedMessgeTypes = Record<string, EthType[]>;

const LoadingStatusEnum = z.enum(["idle", "loading"]);
type LoadingStatus = z.infer<typeof LoadingStatusEnum>;
const ResultStatusEnum = z.enum(["none", "success", "error"]);
type ResultStatus = z.infer<typeof ResultStatusEnum>;

type SignButtonProps = {
  contractData: ContractData;
  children?: React.ReactNode;
  disabled?: boolean;
  onSignatureCreated: (signature: Hex) => void;
  onSignatureCreatedStatus: LoadingStatus;
  onSignatureCreatedResult: ResultStatus;
  types: TypedMessgeTypes;
  message: Record<string, string | number | bigint>;
  primaryType: string;
  testId: string;
};

type OkBoolAction = () => Omit<Response, "json"> & { json(): Promise<{ ok: boolean }> };
type OkBoolFetcher = ReturnType<typeof useFetcher<OkBoolAction>>;

export function fetcherToStatuses(fetcher: OkBoolFetcher): [LoadingStatus, ResultStatus] {
  const fetcherStatus = fetcher.state === "idle" ? "idle" : "loading";
  const resultStatus = fetcher.data === undefined ? "none" : fetcher.data.ok ? "success" : "error";
  return [fetcherStatus, resultStatus];
}

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
  testId,
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
    <Button loading={loading} disabled={disabled} onClick={onClick} data-testid={testId}>
      {children}
    </Button>
  );
}
