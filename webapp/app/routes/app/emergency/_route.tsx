import { saveEmergencyProposal } from "@/.server/service/emergency-proposals";
import { type Proposal, getProposals } from "@/.server/service/proposals";
import { CreateEmergencyProposalModal } from "@/components/create-emergency-proposal-modal";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PROPOSAL_STATES } from "@/utils/proposal-states";
import { PlusIcon } from "@radix-ui/react-icons";
import type { ActionFunctionArgs } from "@remix-run/node";
import { Form, Link, json, useActionData, useLoaderData } from "@remix-run/react";
import { ArrowRight } from "lucide-react";
import { useState } from "react";
import { $path } from "remix-routes";
import { useAccount } from "wagmi";

const isProposalActive = (p: Proposal) =>
  p.state !== PROPOSAL_STATES.Expired && p.state !== PROPOSAL_STATES.Done;
const isProposalInactive = (p: Proposal) => !isProposalActive(p);

export async function loader() {
  const proposals = await getProposals();
  return json({
    activeProposals: proposals.filter(isProposalActive),
    inactiveProposals: proposals.filter(isProposalInactive),
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const formData = await request.formData();
  const data = Object.fromEntries(formData);
  // todo validate data with zod
  console.log("Received data in action:", data);
  await saveEmergencyProposal({ ...data });
  return json({ status: "success", errors: {}, data });
}

export default function Index() {
  const { activeProposals, inactiveProposals } = useLoaderData<typeof loader>();
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
            {activeProposals.map((proposal) => (
              <Link
                key={proposal.id}
                className="flex"
                to={$path("/app/proposals/:id", { id: proposal.id })}
              >
                <Button className="flex flex-1 justify-between pr-4" variant="outline">
                  <span />
                  <span>{proposal.id}</span>
                  <ArrowRight />
                </Button>
              </Link>
            ))}
            {activeProposals.length === 0 && (
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
            {inactiveProposals.map((proposal) => (
              <Link
                key={proposal.id}
                className="flex"
                to={$path("/app/proposals/:id", { id: proposal.id })}
              >
                <Button className="flex flex-1 justify-between pr-4" variant="outline">
                  <span />
                  <span>{proposal.id}</span>
                  <ArrowRight />
                </Button>
              </Link>
            ))}
          </div>
          {inactiveProposals.length === 0 && (
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
