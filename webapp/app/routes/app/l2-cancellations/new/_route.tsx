import { createVetoProposalFor, getActiveL2Proposals } from "@/.server/service/l2-cancellations";
import { addressSchema, hexSchema } from "@/common/basic-schemas";
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
import { badRequest } from "@/utils/http";
import { zodResolver } from "@hookform/resolvers/zod";
import { type ActionFunctionArgs, defer, redirect } from "@remix-run/node";
import { Await, useLoaderData, useNavigation } from "@remix-run/react";
import { Suspense } from "react";
import { useForm } from "react-hook-form";
import { getFormData } from "remix-params-helper";
import { $path } from "remix-routes";
import { numberToHex } from "viem";
import { z } from "zod";
import { useAccount } from "wagmi";

export async function loader() {
  return defer({ activeL2Proposals: getActiveL2Proposals() });
}

export async function action({ request }: ActionFunctionArgs) {
  const parsed = await getFormData(
    request,
    z.object({
      proposalId: hexSchema,
      l2GasLimit: z.coerce.number(),
      l2GasPerPubdataByteLimit: z.coerce.number(),
      refundRecipient: addressSchema,
      txMintValue: z.coerce.number(),
    })
  );
  if (!parsed.success) {
    throw badRequest(`Failed to parse body: ${parsed.errors}`);
  }
  await createVetoProposalFor(
    parsed.data.proposalId,
    numberToHex(parsed.data.l2GasLimit),
    numberToHex(parsed.data.l2GasPerPubdataByteLimit),
    parsed.data.refundRecipient,
    numberToHex(parsed.data.txMintValue)
  );
  return redirect($path("/app/l2-cancellations"));
}

const schema = z.object({
  proposalId: hexSchema,
  l2GasLimit: z.coerce.number({ message: "L2 Gas Limit must be a number" }),
  l2GasPerPubdataByteLimit: z.coerce.number({
    message: "L2 Gas per pubdata byte limit must be a number",
  }),
  refundRecipient: addressSchema,
  txMintValue: z.coerce.number({ message: "Transaction mint value must be a number" }),
});
type Schema = z.infer<typeof schema>;

export default function NewL2GovernorVeto() {
  const { activeL2Proposals } = useLoaderData<typeof loader>();
  const {address} =  useAccount();

  const form = useForm<Schema>({
    resolver: zodResolver(schema),
    defaultValues: {
      l2GasLimit: 600000,
      l2GasPerPubdataByteLimit: 60000,
      refundRecipient: address,
      txMintValue: 1000000000000000
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
              <form method="POST" className="space-y-4">
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
                  </CardContent>
                </Card>

                <Button disabled={!form.formState.isValid} loading={navigation.state !== "idle"}>
                  Create Veto Proposal
                </Button>
              </form>
            </Form>
          </div>
        )}
      </Await>
    </Suspense>
  );
}
