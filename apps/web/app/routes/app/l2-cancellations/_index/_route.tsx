import { getUpdatedL2Cancellations } from "@/.server/service/l2-cancellations";
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
import { json } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { ArrowRight } from "lucide-react";
import { $path } from "remix-routes";
import { Meta } from "@/utils/meta";
import AddButton from "@/components/add-button";

export const meta = Meta["/app/l2-cancellations"];

export async function loader() {
  const proposals = await getUpdatedL2Cancellations();

  console.log(proposals);

  const isActive = (p: (typeof proposals)[number]) => ({
    active: p.status === "ACTIVE" && !p.archivedOn,
    reason:
      p.status === "ACTIVE" && !p.archivedOn
        ? undefined
        : p.archivedOn
          ? "Archived"
          : p.status === "DONE"
            ? "Broadcasted"
            : "Expired",
  });

  return json({
    activeProposals: proposals.filter((p) => isActive(p).active),
    inactiveProposals: proposals
      .filter((p) => !isActive(p).active)
      .map((p) => ({
        ...p,
        reason: isActive(p).reason,
      })),
  });
}

export default function L2Proposals() {
  const { activeProposals, inactiveProposals } = useLoaderData<typeof loader>();

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Active Guardian Vetoes</CardTitle>
            <Link to={$path("/app/l2-cancellations/new")}>
              <AddButton data-testid="new-cancellation-proposal">Create Guardian Veto</AddButton>
            </Link>
          </div>
        </CardHeader>
        <CardContent>
          {activeProposals.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Description</TableHead>
                  <TableHead className="w-20" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {activeProposals.length > 0 &&
                  activeProposals.map((proposal) => (
                    <TableRow key={proposal.id}>
                      <TableCell>{proposal.description}</TableCell>
                      <TableCell>
                        <Link to={$path("/app/l2-cancellations/:id", { id: proposal.id })}>
                          <Button variant="outline" size="sm">
                            View
                            <ArrowRight className="ml-2 h-4 w-4" />
                          </Button>
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          ) : (
            <div className="text-center text-gray-500">No active Guardian Vetoes found.</div>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Inactive Guardian Vetoes</CardTitle>
        </CardHeader>
        <CardContent>
          {inactiveProposals.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Description</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-20" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {inactiveProposals.length > 0 &&
                  inactiveProposals.map((proposal) => (
                    <TableRow key={proposal.id}>
                      <TableCell>{proposal.description}</TableCell>
                      <TableCell>
                        <span className="rounded-full bg-red-100 px-2 py-1 text-red-800 text-xs">
                          {proposal.reason}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Link to={$path("/app/l2-cancellations/:id", { id: proposal.id })}>
                          <Button variant="outline" size="sm">
                            View
                            <ArrowRight className="ml-2 h-4 w-4" />
                          </Button>
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          ) : (
            <div className="text-center text-gray-500">No inactive Guardian Vetoes found.</div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
