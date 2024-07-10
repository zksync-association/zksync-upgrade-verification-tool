import { Button } from "@/components/ui/button";
import { GUARDIANS_RAW_ABI } from "@/utils/raw-abis";
import type React from "react";
import { toast } from "react-hot-toast";
import type { Hex } from "viem";
import { useAccount, useWriteContract } from "wagmi";

type BroadcastTxButtonProps = {
  target: Hex;
  functionName: string;
  signatures: any[];
  threshold: number;
  proposalId: Hex;
  disabled: boolean;
  children?: React.ReactNode;
};

export default function ContractWriteButton({
  children,
  target,
  functionName,
  signatures,
  threshold,
  proposalId,
  disabled,
}: BroadcastTxButtonProps) {
  const { address } = useAccount();
  const { writeContractAsync, isPending } = useWriteContract();

  const doThings = async (e: React.MouseEvent) => {
    e.preventDefault();

    if (signatures.length < threshold === null) {
      throw new Error();
    }

    await writeContractAsync({
      account: address,
      address: target,
      functionName: functionName,
      abi: GUARDIANS_RAW_ABI,
      args: [proposalId, signatures.map((s) => s.signer), signatures.map((s) => s.signature)],
    });

    toast.success("Transaction executed!", { id: "sign_button" });
  };

  return (
    <Button disabled={disabled || isPending || signatures.length < threshold} onClick={doThings}>
      {children}
    </Button>
  );
}
