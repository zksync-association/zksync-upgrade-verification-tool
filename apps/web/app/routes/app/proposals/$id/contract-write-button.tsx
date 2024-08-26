import type { signaturesTable } from "@/.server/db/schema";
import { Button } from "@/components/ui/button";
import { ALL_ABIS } from "@/utils/raw-abis";
import { useNavigate } from "@remix-run/react";
import type { InferSelectModel } from "drizzle-orm";
import type React from "react";
import { toast } from "react-hot-toast";
import { $path } from "remix-routes";
import type { ContractFunctionName, Hex } from "viem";
import { useAccount, useWriteContract } from "wagmi";

type BroadcastTxButtonProps = {
  target: Hex;
  functionName: ContractFunctionName<
    typeof ALL_ABIS.council | typeof ALL_ABIS.guardians,
    "nonpayable"
  >;
  signatures: InferSelectModel<typeof signaturesTable>[];
  threshold: number;
  proposalId: Hex;
  disabled?: boolean;
  abiName: keyof Pick<typeof ALL_ABIS, "guardians" | "council">;
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
  const { isPending, writeContract } = useWriteContract();
  const navigate = useNavigate();

  const thresholdReached = signatures.length >= threshold;

  const onClick = async () => {
    if (!thresholdReached) {
      console.error("Not enough signatures", signatures.length, threshold);
      return;
    }

    toast.loading("Broadcasting transaction...", { id: "broadcasting-tx" });

    writeContract(
      {
        account: address,
        address: target,
        functionName,
        abi: ALL_ABIS[abiName],
        args: [proposalId, signatures.map((s) => s.signer), signatures.map((s) => s.signature)],
      },
      {
        onSuccess: (hash) => {
          toast.success("Transaction broadcasted successfully", { id: "broadcasting-tx" });
          navigate(
            $path("/app/transactions/:hash", {
              hash,
            })
          );
        },
        onError: (e) => {
          console.error(e);
          toast.error("Error broadcasting transaction", { id: "broadcasting-tx" });
        },
      }
    );
  };

  return (
    <Button disabled={disabled || !thresholdReached} loading={isPending} onClick={onClick}>
      {children}
    </Button>
  );
}
