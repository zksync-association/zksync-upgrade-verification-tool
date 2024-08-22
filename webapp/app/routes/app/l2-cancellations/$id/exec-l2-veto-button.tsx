import type { l2CancellationsTable, signaturesTable } from "@/.server/db/schema";
import { Button } from "@/components/ui/button";
import { ALL_ABIS } from "@/utils/raw-abis";
import { useFetcher } from "@remix-run/react";
import type { InferSelectModel } from "drizzle-orm";
import type React from "react";
import { toast } from "react-hot-toast";
import { $path } from "remix-routes";
import { Hex, hexToBigInt } from "viem";
import { useAccount, useWriteContract } from "wagmi";
import { Call } from "@/common/calls";
import { compareHexValues } from "@/utils/compare-hex-values";

type BroadcastTxButtonProps = {
  guardiansAddress: Hex;
  signatures: InferSelectModel<typeof signaturesTable>[];
  threshold: number;
  disabled?: boolean;
  children?: React.ReactNode;
  proposalId: InferSelectModel<typeof l2CancellationsTable>["id"];
  calls: Call[],
  proposal: Proposal
};

type Proposal = {
  description: string;
  txRequestTo: Hex;
  txRequestGasLimit: Hex;
  txRequestL2GasPerPubdataByteLimit: Hex;
  txRequestRefundRecipient: Hex;
  txRequestTxMintValue: Hex;
}

export default function ExecL2VetoButton({
  children,
  guardiansAddress,
  signatures,
  threshold,
  disabled,
  proposalId,
  calls,
  proposal
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

    const l2Proposal = {
      targets: calls.map(c => c.target),
      values: calls.map(c => hexToBigInt(c.value)),
      calldatas: calls.map(c => c.data),
      description: proposal.description
    } as const;

    const txRequest = {
      to: proposal.txRequestTo,
      l2GasLimit: hexToBigInt(proposal.txRequestGasLimit),
      l2GasPerPubdataByteLimit: hexToBigInt(proposal.txRequestL2GasPerPubdataByteLimit),
      refundRecipient: proposal.txRequestRefundRecipient,
      txMintValue: hexToBigInt(proposal.txRequestTxMintValue)
    } as const;

    const orderedSignatures = signatures.sort((a, b) => compareHexValues(a.signer, b.signer))
    const signers = orderedSignatures.map(s => s.signer)
    const signatureValues = orderedSignatures.map(s => s.signature)

    writeContract(
      {
        account: address,
        address: guardiansAddress,
        functionName: "cancelL2GovernorProposal",
        abi: ALL_ABIS.guardians,
        args: [l2Proposal, txRequest, signers, signatureValues],
      },
      {
        onSuccess: (hash) => {
          toast.success("Transaction broadcasted successfully", { id: "broadcasting-tx" });

          // Action redirects to the transaction page
          fetcher.submit(
            { hash },
            {
              method: "POST",
              action: $path("/app/l2-cancellations/:id/write-transaction", {
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
