import { createVetoProposalFor, getActiveL2Proposals } from "@/.server/service/l2-cancellations";
import { addressSchema, hexSchema } from "@/common/basic-schemas";
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
import { type ActionFunctionArgs, json, redirect } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { useForm } from "react-hook-form";
import { getFormData } from "remix-params-helper";
import { $path } from "remix-routes";
import { numberToHex } from "viem";
import { z } from "zod";

export async function loader() {
  const activeL2Proposals = await getActiveL2Proposals();
  return json({ activeL2Proposals });
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
  l2GasLimit: z.coerce.number(),
  l2GasPerPubdataByteLimit: z.coerce.number(),
  refundRecipient: hexSchema,
  txMintValue: z.coerce.number(),
});
type Schema = z.infer<typeof schema>;

const defaultValues = {};

export default function NewL2GovernorVeto() {
  const { activeL2Proposals } = useLoaderData<typeof loader>();
  const form = useForm<Schema>({
    resolver: zodResolver(schema),
    defaultValues,
    mode: "onTouched",
  });

  return (
    <div>
      <Form {...form}>
        <form method="POST">
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

          <FormField
            control={form.control}
            name="l2GasLimit"
            render={({ field }) => (
              <FormItem>
                <FormLabel>L2 Gas Limit</FormLabel>
                <FormControl>
                  <Input {...field} />
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
                  <Input {...field} />
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
                  <Input {...field} />
                </FormControl>
                <FormDescription>
                  The ether minted on L2 in this L1 {"->"} L2 transaction.
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <Button disabled={!form.formState.isValid}>Create</Button>
        </form>
      </Form>
    </div>
  );
}
