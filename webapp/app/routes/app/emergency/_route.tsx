import { getAllEmergencyProposals } from "@/.server/db/dto/emergencyProposals";
import { saveEmergencyProposal } from "@/.server/service/emergency-proposals";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
          <div className="flex flex-col space-y-4">
            {activeEmergencyProposals.map((ep) => (
              <Link key={ep.id} className="flex" to={$path("/app/proposals/:id", { id: ep.id })}>
                <Button className="flex flex-1 justify-between pr-4" variant="outline">
                  <span />
                  <span>{ep.id}</span>
                  <ArrowRight />
                </Button>
              </Link>
            ))}
            {activeEmergencyProposals.length === 0 && (
              <div className="text-center text-gray-500">No active emergency proposals found.</div>
            )}
          </div>
        </CardContent>
      </Card>
      <Card className="pb-10">
        <CardHeader>
          <CardTitle>Inactive Emergency Proposals</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col space-y-4">
            {inactiveEmergencyProposals.map((ep) => (
              <Link key={ep.id} className="flex" to={$path("/app/proposals/:id", { id: ep.id })}>
                <Button className="flex flex-1 justify-between pr-4" variant="outline">
                  <span />
                  <span>{ep.id}</span>
                  <ArrowRight />
                </Button>
              </Link>
            ))}
          </div>
          {inactiveEmergencyProposals.length === 0 && (
            <div className="text-center text-gray-500">No inactive emergency proposals found.</div>
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
