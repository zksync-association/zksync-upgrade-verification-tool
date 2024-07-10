import { Button } from "@/components/ui/button";
import React from "react";
import type { Hex } from "viem";
import { useAccount, useChains, useSignTypedData, useWriteContract } from "wagmi";
import { GUARDIANS_RAW_ABI } from "@/utils/raw-abis";
import { toast } from "react-hot-toast";

type ContractData = {
  name: string;
  address: Hex;
  actionName: string;
};

type BroadcastTxButtonProps = {
  target: Hex;
  functionName: string;
  signatures: any[];
  threshold: number;
  proposalId: Hex;
  disabled: boolean;
  children?: React.ReactNode;
};

export default function ContractWriteButton({ children, target, functionName, signatures, threshold, proposalId, disabled }: BroadcastTxButtonProps) {
  const {address} = useAccount()
  const { writeContractAsync, isPending } = useWriteContract()

  const doThings = async (e: React.MouseEvent) => {
    e.preventDefault();

    if (signatures.length < threshold === null) {
      throw new Error()
    }

    await writeContractAsync({
      account: address,
      address: target,
      functionName: functionName,
      abi: GUARDIANS_RAW_ABI,
      args: [proposalId, signatures.map((s) => s.signer), signatures.map((s) => s.signature)],
    })

    toast.success("Transaction executed!", { id: "sign_button" })
  }

  return <Button disabled={disabled || isPending || signatures.length < threshold} onClick={doThings}>
    {children}
  </Button>
}
