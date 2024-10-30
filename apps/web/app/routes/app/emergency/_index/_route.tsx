import { getAllEmergencyProposals } from "@/.server/db/dto/emergency-proposals";
import { emergencyUpgradeBoardAddress } from "@/.server/service/ethereum-l1/contracts/protocol-upgrade-handler";
import type { EmergencyProposalStatus } from "@/common/emergency-proposal-status";
import AddButton from "@/components/add-button";
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
import { displayBytes32 } from "@/utils/common-tables";
import { formatDateTime } from "@/utils/date";
import { Meta } from "@/utils/meta";
import { Link, json, useLoaderData } from "@remix-run/react";
import { ArrowRight } from "lucide-react";
import { $path } from "remix-routes";

export const meta = Meta["/app/emergency"];

export async function loader() {
  const [emergencyProposals, emergencyBoardAddress] = await Promise.all([
    getAllEmergencyProposals(),
    emergencyUpgradeBoardAddress(),
  ]);

  const isActive = (proposal: (typeof emergencyProposals)[number]) =>
    (proposal.status === "ACTIVE" || proposal.status === "READY") && proposal.archivedOn === null;
  const isInactive = (proposal: (typeof emergencyProposals)[number]) => !isActive(proposal);

  return json({
    activeEmergencyProposals: emergencyProposals.filter(isActive),
    inactiveEmergencyProposals: emergencyProposals.filter(isInactive),
    emergencyBoardAddress,
  });
}

export default function Index() {
  const { activeEmergencyProposals, inactiveEmergencyProposals } = useLoaderData<typeof loader>();

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Active Emergency Upgrades</CardTitle>
            <Link to={$path("/app/emergency/new")}>
              <AddButton data-testid="new-emergency-proposal">Create Emergency Upgrade</AddButton>
            </Link>
          </div>
        </CardHeader>
        <CardContent>
          {activeEmergencyProposals.length === 0 ? (
            <div className="text-center text-gray-500">No active Emergency Upgrades found.</div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[40%]">Title</TableHead>
                    <TableHead className="w-24">Status</TableHead>
                    <TableHead className="w-32">Proposed On</TableHead>
                    <TableHead className="w-32">Upgrade ID</TableHead>
                    <TableHead className="w-20" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {activeEmergencyProposals.map((ep) => (
                    <TableRow key={ep.id}>
                      <TableCell className="max-w-0">
                        <div className="truncate">{ep.title}</div>
                      </TableCell>
                      <TableCell>
                        <span className={`rounded-full px-2 py-1 ${getStatusColor(ep.status)}`}>
                          {ep.status}
                        </span>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {formatDateTime(ep.proposedOn)}
                      </TableCell>
                      <TableCell className="">
                        <div className="truncate">{`${ep.externalId.slice(0, 10)} ... ${ep.externalId.slice(-8)}`}</div>
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
      <Card data-testid="inactive-proposals-card">
        <CardHeader>
          <CardTitle>Inactive Emergency Upgrades</CardTitle>
        </CardHeader>
        <CardContent>
          {inactiveEmergencyProposals.length === 0 ? (
            <div className="text-center text-gray-500">No inactive Emergency Upgrades found.</div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[40%]">Title</TableHead>
                    <TableHead className="w-24">Status</TableHead>
                    <TableHead className="w-32">Closed At</TableHead>
                    <TableHead className="w-32">Upgrade ID</TableHead>
                    <TableHead className="w-20" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {inactiveEmergencyProposals.map((ep) => (
                    <TableRow key={ep.id}>
                      <TableCell className="max-w-0">
                        <div className="truncate">{ep.title}</div>
                      </TableCell>
                      <TableCell>
                        <span
                          className={`rounded-full px-2 py-1 text-xs ${getStatusColor(ep.status, ep.archivedOn !== null)}`}
                        >
                          {ep.archivedOn === null
                            ? ep.status.charAt(0).toUpperCase() + ep.status.slice(1).toLowerCase()
                            : "Archived"}
                        </span>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {formatDateTime(ep.changedOn)}
                      </TableCell>
                      <TableCell>
                        <div className="truncate">{displayBytes32(ep.externalId)}</div>
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

const getStatusColor = (status: EmergencyProposalStatus, archived?: boolean) => {
  if (archived) {
    return "bg-red-100 text-red-800";
  }

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
