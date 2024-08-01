import { getAllEmergencyProposals } from "@/.server/db/dto/emergencyProposals";
import { saveEmergencyProposal } from "@/.server/service/emergency-proposals";
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
import {
  CreateEmergencyProposalModal,
  emergencyPropSchema,
} from "@/routes/app/emergency/create-emergency-proposal-modal";
import { EMERGENCY_PROPOSAL_STATUS, PROPOSAL_STATES } from "@/utils/proposal-states";
import { PlusIcon } from "@radix-ui/react-icons";
import type { ActionFunctionArgs } from "@remix-run/node";
import { Form, Link, json, useActionData, useLoaderData } from "@remix-run/react";
import { ArrowRight } from "lucide-react";
import { useState } from "react";
import { $path } from "remix-routes";
import { useAccount } from "wagmi";

export async function loader() {
  console.log("calling loader");
  const emergencyProposals = await getAllEmergencyProposals();

  console.dir(emergencyProposals);
  return json({
    activeEmergencyProposals: emergencyProposals.filter(({ status }) => status === "ACTIVE"),
    inactiveEmergencyProposals: emergencyProposals.filter(
      ({ status }) => status === "CLOSED" || status === "BROADCAST"
    ),
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const formData = await request.formData();
  const data = Object.fromEntries(formData);
  const parsedData = emergencyPropSchema.parse(data);
  await saveEmergencyProposal(parsedData);
  return json({ status: "success", errors: {}, data: parsedData });
}

export default function Index() {
  const { activeEmergencyProposals, inactiveEmergencyProposals } = useLoaderData<typeof loader>();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const actionData = useActionData<typeof action>();
  const { address } = useAccount();

  return (
    <div className="mt-10 space-y-4">
      <Card className="pb-10">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Active Emergency Proposals</CardTitle>
            <Button variant="secondary" size="icon" onClick={() => setIsModalOpen(true)}>
              <PlusIcon className="h-4 w-4" />
            </Button>
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
                    <TableHead className="w-32">Proposer</TableHead>
                    <TableHead className="w-32">Proposed On</TableHead>
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
                        <div className="truncate">{ep.proposer}</div>
                      </TableCell>
                      <TableCell className="text-xs whitespace-nowrap">
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
                        <Link to={$path("/app/proposals/:id", { id: ep.id })}>
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
                    <TableHead className="w-32">Proposer</TableHead>
                    <TableHead className="w-32">Proposed On</TableHead>
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
                        <div className="truncate">{ep.proposer}</div>
                      </TableCell>
                      <TableCell className="text-xs whitespace-nowrap">
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
                        <Link to={$path("/app/proposals/:id", { id: ep.id })}>
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
      <Form method="post">
        <CreateEmergencyProposalModal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          errors={actionData?.errors as object}
          status={actionData?.status}
          proposerAddress={address}
        />
      </Form>
    </div>
  );
}
