import { Button } from "@/components/ui/button";
import type { action } from "@/routes/app/proposals.$id/_route";
import { useFetcher } from "@remix-run/react";
import { type MouseEvent, useEffect } from "react";
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
};

export default function SignButton({ children, proposalId, contractData }: SignButtonProps) {
  const { signTypedDataAsync: signTypedData, data } = useSignTypedData();
  const [chain] = useChains();
  const fetcher = useFetcher<typeof action>();

  useEffect(() => {
    if (fetcher.state === "submitting") {
      toast.loading("Signing...", { id: "sign_button" });
    }
    if (fetcher.state === "idle" && fetcher.data?.ok) {
      toast.success("Signed successfully", { id: "sign_button" });
    }
  }, [fetcher.state, fetcher.data]);

  async function onClick(e: MouseEvent) {
    e.preventDefault();
    const signature = await signTypedData({
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
    });

    fetcher.submit(
      { signature, actionName: contractData.actionName, proposalId },
      { method: "POST" }
    );
  }

  return <Button onClick={onClick}>{children}</Button>;
}
