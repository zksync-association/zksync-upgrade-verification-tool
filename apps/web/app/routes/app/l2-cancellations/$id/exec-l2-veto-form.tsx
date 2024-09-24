import type { Call } from "@/common/calls";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormDescription,
  FormInput,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { compareHexValues } from "@/utils/compare-hex-values";
import { guardiansAbi } from "@/utils/contract-abis";
import type { BasicSignature } from "@/utils/signatures";
import { useFetcher } from "@remix-run/react";
import type React from "react";
import { useState } from "react";
import { toast } from "react-hot-toast";
import { $path } from "remix-routes";
import { type Hex, hexToBigInt, parseEther } from "viem";
import { useAccount, useWriteContract } from "wagmi";
import { z } from "zod";

type BroadcastTxButtonProps = {
  guardiansAddress: Hex;
  signatures: BasicSignature[];
  threshold: number;
  disabled?: boolean;
  children?: React.ReactNode;
  proposalId: number;
  calls: Call[];
  proposal: Proposal;
};

type Proposal = {
  description: string;
  txRequestTo: Hex;
  txRequestGasLimit: Hex;
  txRequestL2GasPerPubdataByteLimit: Hex;
  txRequestRefundRecipient: Hex;
  txRequestTxMintValue: Hex;
};

export default function ExecL2VetoForm({
  children,
  guardiansAddress,
  signatures,
  threshold,
  disabled,
  proposalId,
  calls,
  proposal,
}: BroadcastTxButtonProps) {
  const { address } = useAccount();
  const { isPending, writeContract } = useWriteContract();
  const fetcher = useFetcher();
  const [valueError, setValueError] = useState<string | null>(null);

  const thresholdReached = signatures.length >= threshold;

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    const formData = new FormData(e.currentTarget);
    const value = z.coerce.number().min(0).safeParse(formData.get("value"));
    if (!value.success) {
      setValueError("Invalid value");
      return;
    }

    setValueError(null);

    if (!thresholdReached) {
      console.error("Not enough signatures", signatures.length, threshold);
      return;
    }

    toast.loading("Broadcasting transaction...", { id: "broadcasting-tx" });

    const l2Proposal = {
      targets: calls.map((c) => c.target),
      values: calls.map((c) => hexToBigInt(c.value)),
      calldatas: calls.map((c) => c.data),
      description: proposal.description,
    } as const;

    const txRequest = {
      to: proposal.txRequestTo,
      l2GasLimit: hexToBigInt(proposal.txRequestGasLimit),
      l2GasPerPubdataByteLimit: hexToBigInt(proposal.txRequestL2GasPerPubdataByteLimit),
      refundRecipient: proposal.txRequestRefundRecipient,
      txMintValue: hexToBigInt(proposal.txRequestTxMintValue),
    } as const;

    const orderedSignatures = signatures.sort((a, b) => compareHexValues(a.signer, b.signer));
    const signers = orderedSignatures.map((s) => s.signer);
    const signatureValues = orderedSignatures.map((s) => s.signature);

    writeContract(
      {
        account: address,
        address: guardiansAddress,
        functionName: "cancelL2GovernorProposal",
        abi: guardiansAbi,
        args: [l2Proposal, txRequest, signers, signatureValues],
        value: parseEther(value.data.toString()),
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
    <Form onSubmit={handleSubmit}>
      <FormItem name="value">
        <FormLabel>Value (Eth)</FormLabel>
        <FormInput
          placeholder="ETH"
          defaultValue={0.001}
          type="number"
          min={0}
          step={0.000000001}
        />
        <FormDescription>Value of ether to send in the tx</FormDescription>
        <FormMessage data-testid="title-error"> {valueError}</FormMessage>
      </FormItem>
      <Button disabled={disabled || !thresholdReached} loading={isPending}>
        {children}
      </Button>
    </Form>
  );
}
