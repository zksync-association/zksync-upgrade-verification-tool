import type { Call } from "@/common/calls";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { compareHexValues } from "@/utils/compare-hex-values";
import { ALL_ABIS } from "@/utils/raw-abis";
import type { BasicSignature } from "@/utils/signatures";
import { zodResolver } from "@hookform/resolvers/zod";
import { useFetcher } from "@remix-run/react";
import type React from "react";
import { useForm } from "react-hook-form";
import { toast } from "react-hot-toast";
import { $path } from "remix-routes";
import { type Hex, hexToBigInt, parseEther } from "viem";
import { useAccount, useWriteContract } from "wagmi";
import { z } from "zod";

const submitSchema = z.object({
  value: z
    .string()
    .refine((str) => /^\d+\.?\d*$/.test(str), { message: "Should be a numeric value" }),
});

type SubmitType = z.infer<typeof submitSchema>;

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

  const thresholdReached = signatures.length >= threshold;

  const onSubmit = async ({ value }: SubmitType) => {
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
        abi: ALL_ABIS.guardians,
        args: [l2Proposal, txRequest, signers, signatureValues],
        value: parseEther(value),
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

  const form = useForm<SubmitType>({
    resolver: zodResolver(submitSchema),
    defaultValues: {
      value: "0.001",
    },
    mode: "onTouched",
  });

  return (
    <div>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)}>
          <FormField
            control={form.control}
            name="value"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Value (Eth)</FormLabel>
                <FormControl>
                  <Input placeholder="ETH" {...field} />
                </FormControl>
                <FormDescription>Value of ether to send in the tx</FormDescription>
                <FormMessage data-testid="title-error" />
              </FormItem>
            )}
          />
          <Button
            disabled={!form.formState.isValid || disabled || !thresholdReached}
            loading={isPending}
          >
            {children}
          </Button>
        </form>
      </Form>
    </div>
  );
}
