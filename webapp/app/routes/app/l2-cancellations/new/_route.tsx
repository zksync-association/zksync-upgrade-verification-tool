import { getMaxRegisteredNonce } from "@/.server/db/dto/l2-cancellations";
import {
  createVetoProposalFor,
  getActiveL2Proposals,
  getL2VetoNonce,
} from "@/.server/service/l2-cancellations";
import { addressSchema, hexSchema, nonZeroBigIntStrSchema } from "@/common/basic-schemas";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import Loading from "@/components/ui/loading";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { extract } from "@/utils/extract-from-formdata";
import { badRequest } from "@/utils/http";
import { env } from "@config/env.server";
import { zodResolver } from "@hookform/resolvers/zod";
import { type ActionFunctionArgs, defer, redirect } from "@remix-run/node";
import { Await, useLoaderData, useNavigation } from "@remix-run/react";
import { Form as RemixForm } from "@remix-run/react";
import { Suspense } from "react";
import { useForm } from "react-hook-form";
import { $path } from "remix-routes";
import { numberToHex } from "viem";
import { useAccount } from "wagmi";
import { z } from "zod";

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
  if (!env.SHOW_PRIVATE_ACTIONS) {
    return redirect($path("/"));
  }

  const formData = await request.formData().catch(() => {
    throw badRequest("Failed to parse body");
  });

  const proposalId = extract(formData, "proposalId", hexSchema);
  const l2GasLimit = extract(formData, "l2GasLimit", z.coerce.bigint());
  const l2GasPerPubdataByteLimit = extract(formData, "l2GasPerPubdataByteLimit", z.coerce.bigint());
  const refundRecipient = extract(formData, "refundRecipient", addressSchema);
  const txMintValue = extract(formData, "txMintValue", z.coerce.bigint());
  const nonce = extract(formData, "nonce", z.coerce.number());

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

const schema = z.object({
  proposalId: hexSchema,
  l2GasLimit: nonZeroBigIntStrSchema,
  l2GasPerPubdataByteLimit: nonZeroBigIntStrSchema,
  refundRecipient: addressSchema,
  txMintValue: nonZeroBigIntStrSchema,
  nonce: z.coerce.number({ message: "Nonce value must be a number" }),
});
type Schema = z.infer<typeof schema>;

export default function NewL2GovernorVeto() {
  const { activeL2Proposals, currentNonce, suggestedNonce } = useLoaderData<typeof loader>();
  const { address } = useAccount();
  const form = useForm<Schema>({
    resolver: zodResolver(
      schema.extend({
        nonce: z.coerce.number().min(currentNonce),
      })
    ),
    defaultValues: {
      nonce: suggestedNonce,
      l2GasLimit: "80000000",
      l2GasPerPubdataByteLimit: "800",
      refundRecipient: address,
      txMintValue: "1000000000000000",
    },
    mode: "onTouched",
  });
  const navigation = useNavigation();

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
          <div>
            <Form {...form}>
              <RemixForm method="POST" className="space-y-4">
                <Card className="pb-10">
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
                                <FormField
                                  control={form.control}
                                  name="proposalId"
                                  render={({ field }) => (
                                    <FormItem>
                                      <FormControl>
                                        <Input type={"radio"} {...field} value={row.proposalId} />
                                      </FormControl>
                                    </FormItem>
                                  )}
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
                    <FormField
                      control={form.control}
                      name="l2GasLimit"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>L2 Gas Limit</FormLabel>
                          <FormControl>
                            <Input type="number" min={1} {...field} />
                          </FormControl>
                          <FormDescription>
                            The maximum gas limit for executing this transaction on L2.
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="l2GasPerPubdataByteLimit"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>L2 gas per pubdata byte limit</FormLabel>
                          <FormControl>
                            <Input type="number" min={0} {...field} />
                          </FormControl>
                          <FormDescription>
                            Limits the amount of gas per byte of public data on L2.
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="refundRecipient"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Refund Recipient</FormLabel>
                          <FormControl>
                            <Input {...field} />
                          </FormControl>
                          <FormDescription>
                            The L2 address to which any refunds should be sent.
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="txMintValue"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Transaction mint value</FormLabel>
                          <FormControl>
                            <Input type="number" min={0} {...field} />
                          </FormControl>
                          <FormDescription>
                            The ether minted on L2 in this L1 {"->"} L2 transaction.
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="nonce"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Nonce</FormLabel>
                          <FormControl>
                            <Input type="number" min={currentNonce} {...field} />
                          </FormControl>
                          <FormDescription>
                            The ether minted on L2 in this L1 {"->"} L2 transaction.
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </CardContent>
                </Card>

                <Button disabled={!form.formState.isValid} loading={navigation.state !== "idle"}>
                  Create Veto Proposal
                </Button>
              </RemixForm>
            </Form>
          </div>
        )}
      </Await>
    </Suspense>
  );
}
