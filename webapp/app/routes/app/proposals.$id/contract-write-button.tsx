import { Button } from "@/components/ui/button";
import { ALL_ABIS } from "@/utils/raw-abis";
import type React from "react";
import { useEffect } from "react";
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
  abiName: "guardians" | "council";
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
  abiName,
}: BroadcastTxButtonProps) {
  const { address } = useAccount();
  const { writeContractAsync, isPending, isSuccess } = useWriteContract();

  useEffect(() => {
    if (isSuccess) {
      toast.success("Transaction executed!", { id: "execute_tx" });
    }
  }, [isSuccess]);

  const execContractWrite = async (e: React.MouseEvent) => {
    e.preventDefault();

    try {
      await writeContractAsync({
        account: address,
        address: target,
        functionName: functionName,
        abi: ALL_ABIS[abiName],
        args: [proposalId, signatures.map((s) => s.signer), signatures.map((s) => s.signature)],
      });
    } catch (e) {
      console.error(e);
      if (e instanceof Error) {
        if (e.message.includes("User rejected the request.")) {
          toast("Transaction canceled", { icon: "✖️" });
        } else {
          toast.error(`Error broadcasting tx: ${e.message}`);
        }
      } else {
        toast.error(`Error broadcasting tx: ${e}`);
      }
    }
  };

  return (
    <Button
      disabled={disabled || isPending || signatures.length < threshold}
      onClick={execContractWrite}
    >
      {children}
    </Button>
  );
}
