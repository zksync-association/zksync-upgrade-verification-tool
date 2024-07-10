import { Button } from "@/components/ui/button";
import React from "react";
import type { Hex } from "viem";
import { useAccount, useChains, useSignTypedData, useWriteContract } from "wagmi";
import { GUARDIANS_RAW_ABI } from "@/utils/raw-abis";

type ContractData = {
  name: string;
  address: Hex;
  actionName: string;
};

type BroadcastTxButtonProps = {
  target: Hex;
  functionName: string;
  args: any[] | null;
  children?: React.ReactNode;
};

export default function BroadcastTxButton({ children, target, functionName, args }: BroadcastTxButtonProps) {
  const {address} = useAccount()
  const { writeContractAsync } = useWriteContract()

  const doThings = async (e: React.MouseEvent) => {
    e.preventDefault();

    if (args === null) {
      throw new Error()
    }

    await writeContractAsync({
      account: address,
      address: target,
      functionName: functionName,
      abi: GUARDIANS_RAW_ABI,
      args: args
    })
  }

  return <Button disabled={args === null} onClick={doThings}>
    {children}
  </Button>
  // const { signTypedDataAsync: signTypedData, isPending } = useSignTypedData();
  // const [chain] = useChains();
  // const fetcher = useFetcher<typeof action>();
  //
  // useEffect(() => {
  //   if (fetcher.state === "submitting") {
  //     toast.loading("Signing...", { id: "sign_button" });
  //   }
  //   if (fetcher.state === "idle" && fetcher.data?.ok) {
  //     toast.success("Signed successfully", { id: "sign_button" });
  //   }
  // }, [fetcher.state, fetcher.data]);
  //
  // async function onClick(e: MouseEvent) {
  //   e.preventDefault();
  //   const signature = await signTypedData({
  //     domain: {
  //       name: contractData.name,
  //       version: "1",
  //       chainId: chain.id,
  //       verifyingContract: contractData.address,
  //     },
  //     primaryType: contractData.actionName,
  //     message: {
  //       id: proposalId,
  //     },
  //     types: {
  //       [contractData.actionName]: [
  //         {
  //           name: "id",
  //           type: "bytes32",
  //         },
  //       ],
  //     },
  //   });
  //
  //   fetcher.submit(
  //     { signature, actionName: contractData.actionName, proposalId },
  //     { method: "POST" }
  //   );
  // }
  //
  // return (
  //   <Button disabled={isPending} onClick={onClick}>
  //     {children}
  //   </Button>
  // );
}
