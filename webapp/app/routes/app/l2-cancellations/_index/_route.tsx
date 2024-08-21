import { getZkGovOpsProposals } from "@/.server/service/l2-cancellations";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PlusIcon } from "@radix-ui/react-icons";
import { json } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { ArrowRight } from "lucide-react";
import { $path } from "remix-routes";

export async function loader() {
  const proposals = await getZkGovOpsProposals();
  return json({ proposals });
}

export default function L2Proposals() {
  const { proposals } = useLoaderData<typeof loader>();
  return (
    <Card className="pb-10">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Active L2 Veto Proposals</CardTitle>
          <Link to={$path("/app/l2-cancellations/new")}>
            <Button data-testid="new-emergency-proposal" variant="secondary" size="icon">
              <PlusIcon className="h-4 w-4" />
            </Button>
          </Link>
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Description</TableHead>
              <TableHead className="w-20" />
            </TableRow>
          </TableHeader>

          <TableBody>
            {proposals.map((proposal) => (
              <TableRow key={proposal.id}>
                <TableCell>{proposal.description}</TableCell>
                <TableCell>
                  <Link to={$path("/app/l2-cancellations/:id", { id: proposal.externalId })}>
                    <Button variant="outline" size="sm">
                      Go
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </Button>
                  </Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
