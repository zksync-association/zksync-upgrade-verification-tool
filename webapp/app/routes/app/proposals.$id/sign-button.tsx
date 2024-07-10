import { Button } from "@/components/ui/button";
import { useFetcher } from "@remix-run/react";
import { type MouseEvent, useCallback } from "react";
import type { Hex } from "viem";
import { useAccount, useChains, useSignTypedData } from "wagmi";

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
  const { address } = useAccount();
  const [chain] = useChains();
  const fetcher = useFetcher();

  const onClick = useCallback(
    (e: MouseEvent) => {
      e.preventDefault();
      signTypedData({
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
    },
    [
      contractData.name,
      contractData.actionName,
      contractData.address,
      proposalId,
      signTypedData,
      chain.id,
    ]
  );

  return (
    <fetcher.Form action={`/app/proposals/${proposalId}`} method={"POST"}>
      <input name="signature" type="hidden" value={data || ""} />
      <input name="address" type="hidden" value={address} />
      <input name="actionName" type="hidden" value={contractData.actionName} />
      <input name="proposalId" type="hidden" value={proposalId} />
      {!data && <Button onClick={onClick}>1/2{children}</Button>}
      {data && <Button>2/2 Submit</Button>}
    </fetcher.Form>
  );
}
