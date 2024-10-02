import { getMaxRegisteredNonce } from "@/.server/db/dto/l2-cancellations";
import {
  createVetoProposalFor,
  getActiveL2Proposals,
  getL2VetoNonce,
} from "@/.server/service/l2-cancellations";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FormDescription, FormMessage, FormInput, FormItem, FormLabel } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import Loading from "@/components/ui/loading";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formError } from "@/utils/action-errors";
import { zodStringToBigIntPipe, zodStringToNumberPipe } from "@/utils/form-number-schema";
import { getFormData } from "@/utils/read-from-request";
import { type ActionFunctionArgs, defer, redirect } from "@remix-run/node";
import { Await, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import { Form } from "@remix-run/react";
import { addressSchema, hexSchema } from "@repo/common/schemas";
import { Suspense, useState } from "react";
import { $path } from "remix-routes";
import { numberToHex } from "viem";
import { useAccount } from "wagmi";
import { z } from "zod";
import { Meta } from "@/utils/meta";

export const meta = Meta["/app/l2-cancellations/new"];

export async function loader() {
  const maybeBiggestNonce = await getMaxRegisteredNonce();
  const biggestNonce = maybeBiggestNonce === null ? -1 : maybeBiggestNonce;
  const currentNonce = await getL2VetoNonce();
  return defer({
    activeL2Proposals: getActiveL2Proposals(),
    currentNonce: currentNonce,
    suggestedNonce: Math.max(currentNonce, biggestNonce + 1),
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const data = await getFormData(request, {
    proposalId: hexSchema,
    l2GasLimit: zodStringToBigIntPipe(
      z
        .bigint({
          message: "L2 gas limit is required",
        })
        .min(1n, "L2 gas limit must be greater than 0")
    ),
    l2GasPerPubdataByteLimit: zodStringToBigIntPipe(
      z
        .bigint({
          message: "L2 gas per pubdata byte limit is required",
        })
        .min(1n, "L2 gas per pubdata byte limit must be greater than 0")
    ),
    refundRecipient: addressSchema,
    txMintValue: zodStringToBigIntPipe(
      z
        .bigint({
          message: "Transaction mint value is required",
        })
        .min(0n, "Transaction mint value must be greater than 0")
    ),
    nonce: zodStringToNumberPipe(
      z
        .number({
          message: "Nonce is required",
        })
        .min(0)
    ),
  });
  if (!data.success) {
    return formError(data.errors);
  }

  const { proposalId, l2GasLimit, l2GasPerPubdataByteLimit, refundRecipient, txMintValue, nonce } =
    data.data;

  await createVetoProposalFor(
    proposalId,
    numberToHex(l2GasLimit),
    numberToHex(l2GasPerPubdataByteLimit),
    refundRecipient,
    numberToHex(txMintValue),
    nonce
  );
  return redirect($path("/app/l2-cancellations"));
}

export default function NewL2GovernorVeto() {
  const { activeL2Proposals, currentNonce, suggestedNonce } = useLoaderData<typeof loader>();
  const { address } = useAccount();
  const navigation = useNavigation();
  const [selectedProposalId, setSelectedProposalId] = useState<string | null>(null);
  const actionData = useActionData<typeof action>();

  const formDefaultValues = {
    nonce: suggestedNonce,
    l2GasLimit: "80000000",
    l2GasPerPubdataByteLimit: "800",
    refundRecipient: address,
    txMintValue: "1000000000000000",
  };

  return (
    <Suspense
      fallback={
        <div className="flex flex-1 flex-col items-center justify-center space-y-6">
          <Loading />
          <h2>Loading active proposals...</h2>
        </div>
      }
    >
      <Await resolve={activeL2Proposals}>
        {(activeL2Proposals) => (
          <Form method="POST" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>1. Select an active proposal</CardTitle>
              </CardHeader>
              <CardContent>
                {activeL2Proposals.length > 0 && (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>ID</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {activeL2Proposals.map((row) => (
                        <TableRow key={row.proposalId}>
                          <TableCell>{row.proposalId}</TableCell>
                          <TableCell>{row.type}</TableCell>
                          <TableCell>{row.description}</TableCell>
                          <TableCell>
                            <Input
                              type={"radio"}
                              name="proposalId"
                              value={row.proposalId}
                              onChange={() => setSelectedProposalId(row.proposalId)}
                            />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
                {activeL2Proposals.length === 0 && (
                  <div className="text-center text-gray-500">No active proposals found.</div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>2. Fill in the details for the veto proposal</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormItem name="l2GasLimit">
                  <FormLabel>L2 Gas Limit</FormLabel>
                  <FormInput type="number" min={1} defaultValue={formDefaultValues.l2GasLimit} />
                  <FormDescription>
                    The maximum gas limit for executing this transaction on L2.
                  </FormDescription>
                  <FormMessage>{actionData?.errors?.l2GasLimit}</FormMessage>
                </FormItem>

                <FormItem name="l2GasPerPubdataByteLimit">
                  <FormLabel>L2 gas per pubdata byte limit</FormLabel>
                  <FormInput
                    type="number"
                    min={0}
                    defaultValue={formDefaultValues.l2GasPerPubdataByteLimit}
                  />
                  <FormDescription>
                    Limits the amount of gas per byte of public data on L2.
                  </FormDescription>
                  <FormMessage>{actionData?.errors?.l2GasPerPubdataByteLimit}</FormMessage>
                </FormItem>

                <FormItem name="refundRecipient">
                  <FormLabel>Refund Recipient</FormLabel>
                  <FormInput type="text" defaultValue={formDefaultValues.refundRecipient} />
                  <FormDescription>
                    The L2 address to which any refunds should be sent.
                  </FormDescription>
                  <FormMessage>{actionData?.errors?.refundRecipient}</FormMessage>
                </FormItem>

                <FormItem name="txMintValue">
                  <FormLabel>Transaction mint value</FormLabel>
                  <FormInput type="number" min={0} defaultValue={formDefaultValues.txMintValue} />
                  <FormDescription>
                    The ether minted on L2 in this L1 {"->"} L2 transaction.
                  </FormDescription>
                  <FormMessage>{actionData?.errors?.txMintValue}</FormMessage>
                </FormItem>

                <FormItem name="nonce">
                  <FormLabel>Nonce</FormLabel>
                  <FormInput
                    type="number"
                    min={currentNonce}
                    defaultValue={formDefaultValues.nonce}
                  />
                  <FormDescription>
                    The ether minted on L2 in this L1 {"->"} L2 transaction.
                  </FormDescription>
                  <FormMessage>{actionData?.errors?.nonce}</FormMessage>
                </FormItem>
              </CardContent>
            </Card>

            <Button
              loading={navigation.state !== "idle"}
              type="submit"
              disabled={!selectedProposalId}
            >
              Create Veto Proposal
            </Button>
          </Form>
        )}
      </Await>
    </Suspense>
  );
}
