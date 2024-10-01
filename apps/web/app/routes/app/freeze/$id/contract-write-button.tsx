import type { freezeProposalsTable, signaturesTable } from "@/.server/db/schema";
import { Button } from "@/components/ui/button";
import { securityCouncilAbi } from "@/utils/contract-abis";
import { dateToUnixTimestamp } from "@/utils/date";
import { useFetcher } from "@remix-run/react";
import type { InferSelectModel } from "drizzle-orm";
import type React from "react";
import { toast } from "react-hot-toast";
import { $path } from "remix-routes";
import type { ContractFunctionName, Hex } from "viem";
import { useAccount, useWriteContract } from "wagmi";

type BroadcastTxButtonProps = {
  target: Hex;
  signatures: InferSelectModel<typeof signaturesTable>[];
  threshold: number;
  disabled?: boolean;
  children?: React.ReactNode;
  validUntil: Date;
  functionName: ContractFunctionName<typeof securityCouncilAbi, "nonpayable">;
  proposalId: InferSelectModel<typeof freezeProposalsTable>["id"];
  softFreezeThreshold: number | null;
};

export default function ContractWriteButton({
  children,
  target,
  signatures,
  threshold,
  disabled,
  validUntil,
  functionName,
  proposalId,
  softFreezeThreshold,
}: BroadcastTxButtonProps) {
  const { address } = useAccount();
  const { isPending, writeContract } = useWriteContract();
  const fetcher = useFetcher();

  const thresholdReached = signatures.length >= threshold;

  const onClick = async () => {
    if (!thresholdReached) {
      console.error("Not enough signatures", signatures.length, threshold);
      return;
    }

    toast.loading("Broadcasting transaction...", { id: "broadcasting-tx" });

    const args = {
      validUntil: BigInt(dateToUnixTimestamp(validUntil)),
      signers: signatures.map((s) => s.signer),
      signatures: signatures.map((s) => s.signature),
      softFreezeThreshold: BigInt(softFreezeThreshold ?? 0),
    };

    writeContract(
      {
        account: address,
        address: target,
        functionName,
        abi: securityCouncilAbi,
        args:
          functionName === "setSoftFreezeThreshold"
            ? [args.softFreezeThreshold, args.validUntil, args.signers, args.signatures]
            : [args.validUntil, args.signers, args.signatures],
      },
      {
        onSuccess: (hash) => {
          toast.success("Transaction broadcasted successfully", { id: "broadcasting-tx" });

          // Action redirects to the transaction page
          fetcher.submit(
            { hash },
            {
              method: "POST",
              action: $path("/app/freeze/:id/write-transaction", {
                id: proposalId,
              }),
            }
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
