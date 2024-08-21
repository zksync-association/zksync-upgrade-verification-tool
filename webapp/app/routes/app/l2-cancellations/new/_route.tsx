import {
  createVetoProposalFor,
  getActiveL2Proposals,
} from "@/.server/service/l2-cancellations";
import { hexSchema } from "@/common/basic-schemas";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem } from "@/components/ui/form";
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
import { useCallback } from "react";
import { useForm } from "react-hook-form";
import { getFormData } from "remix-params-helper";
import { $path } from "remix-routes";
import { z } from "zod";

export async function loader() {
  const activeL2Proposals = await getActiveL2Proposals();
  return json({ activeL2Proposals });
}

export async function action({ request }: ActionFunctionArgs) {
  const parsed = await getFormData(request, z.object({ proposalId: hexSchema }));
  if (!parsed.success) {
    throw badRequest(`Failed to parse body: ${parsed.errors}`);
  }
  await createVetoProposalFor(parsed.data.proposalId);
  return redirect($path("/app/l2-governor-proposals"));
}

const schema = z.object({
  proposalId: hexSchema,
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

  const onSubmit = useCallback(
    ({ proposalId }: Schema) => {
      const l2Proposal = activeL2Proposals.find((prop) => prop.proposalId === proposalId);
      if (!l2Proposal) {
        throw new Error("Proposal is not present");
      }
    },
    [activeL2Proposals]
  );

  return (
    <div>
      <Form {...form}>
        <form method="POST">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                <TableHead>Description</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {activeL2Proposals.map((row) => (
                <TableRow key={row.proposalId}>
                  <TableCell>{row.proposalId}</TableCell>
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

          <Button disabled={!form.formState.isValid}>Create</Button>
        </form>
      </Form>
    </div>
  );
}
