import { getAllEmergencyProposals } from "@/.server/db/dto/emergencyProposals";
import { emergencyBoardAddress } from "@/.server/service/authorized-users";
import type { EmergencyProposalStatus } from "@/common/proposal-status";
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
import { requireUserFromHeader } from "@/utils/auth-headers";
import { PlusIcon } from "@radix-ui/react-icons";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { Link, json, useLoaderData } from "@remix-run/react";
import { ArrowRight } from "lucide-react";
import { $path } from "remix-routes";

export async function loader(args: LoaderFunctionArgs) {
  const emergencyProposals = await getAllEmergencyProposals();
  const user = requireUserFromHeader(args.request);
  return json({
    activeEmergencyProposals: emergencyProposals.filter(
      ({ status }) => status === "ACTIVE" || status === "READY"
    ),
    inactiveEmergencyProposals: emergencyProposals.filter(
      ({ status }) => status === "CLOSED" || status === "BROADCAST"
    ),
    emergencyBoardAddress: await emergencyBoardAddress(),
    currentUser: user.address,
  });
}

export default function Index() {
  const { activeEmergencyProposals, inactiveEmergencyProposals } = useLoaderData<typeof loader>();

  return (
    <div className="mt-10 space-y-4">
      <Card className="pb-10">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Active Emergency Proposals</CardTitle>
            <a href={$path("/app/emergency/new")}>
              <Button data-testid="new-emergency-proposal" variant="secondary" size="icon">
                <PlusIcon className="h-4 w-4" />
              </Button>
            </a>
          </div>
        </CardHeader>
        <CardContent>
          {activeEmergencyProposals.length === 0 ? (
            <div className="text-center text-gray-500">No active emergency proposals found.</div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-16">ID</TableHead>
                    <TableHead className="w-[40%]">Title</TableHead>
                    <TableHead className="w-32">ProposalId</TableHead>
                    <TableHead className="w-32">Proposed On</TableHead>
                    <TableHead className="w-24">Status</TableHead>
                    <TableHead className="w-20" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {activeEmergencyProposals.map((ep) => (
                    <TableRow key={ep.id}>
                      <TableCell>{ep.id}</TableCell>
                      <TableCell className="max-w-0">
                        <div className="truncate">{ep.title}</div>
                      </TableCell>
                      <TableCell className="text-xs">
                        <div className="truncate">{`${ep.externalId.slice(0, 10)} ... ${ep.externalId.slice(-8)}`}</div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs">
                        {new Date(ep.proposedOn).toLocaleString("en-US", {
                          weekday: "short",
                          day: "numeric",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                          hour12: false,
                          timeZoneName: "short",
                        })}
                      </TableCell>
                      <TableCell>
                        <span
                          className={`rounded-full px-2 py-1 text-xs ${getStatusColor(ep.status)}`}
                        >
                          {ep.status}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Link to={$path("/app/emergency/:id", { id: ep.externalId })}>
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
            </div>
          )}
        </CardContent>
      </Card>
      <Card className="pb-10">
        <CardHeader>
          <CardTitle>Inactive Emergency Proposals</CardTitle>
        </CardHeader>
        <CardContent>
          {inactiveEmergencyProposals.length === 0 ? (
            <div className="text-center text-gray-500">No inactive emergency proposals found.</div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-16">ID</TableHead>
                    <TableHead className="w-[40%]">Title</TableHead>
                    <TableHead className="w-32">ProposalId</TableHead>
                    <TableHead className="w-32">Closed At</TableHead>
                    <TableHead className="w-24">Status</TableHead>
                    <TableHead className="w-20" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {inactiveEmergencyProposals.map((ep) => (
                    <TableRow key={ep.id}>
                      <TableCell>{ep.id}</TableCell>
                      <TableCell className="max-w-0">
                        <div className="truncate">{ep.title}</div>
                      </TableCell>
                      <TableCell className="text-xs">
                        <div className="truncate">{`${ep.externalId.slice(0, 10)} ... ${ep.externalId.slice(-8)}`}</div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs">
                        {new Date(ep.changedOn).toLocaleString("en-US", {
                          weekday: "short",
                          day: "numeric",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                          hour12: false,
                          timeZoneName: "short",
                        })}
                      </TableCell>
                      <TableCell>
                        <span
                          className={`rounded-full px-2 py-1 text-xs ${getStatusColor(ep.status)}`}
                        >
                          {ep.status}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Link to={$path("/app/emergency/:id", { id: ep.externalId })}>
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
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

const getStatusColor = (status: EmergencyProposalStatus) => {
  switch (status) {
    case "ACTIVE":
      return "bg-green-100 text-green-800";
    case "READY":
      return "bg-yellow-100 text-yellow-800";
    case "CLOSED":
      return "bg-red-100 text-red-800";
    case "BROADCAST":
      return "bg-blue-100 text-blue-800";
    default:
      return "bg-gray-100 text-gray-800";
  }
};
