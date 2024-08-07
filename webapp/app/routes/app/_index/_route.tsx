import { type Proposal, getProposals } from "@/.server/service/proposals";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PROPOSAL_STATES } from "@/utils/proposal-states";
import { Link, json, useLoaderData } from "@remix-run/react";
import { ArrowRight } from "lucide-react";
import { $path } from "remix-routes";

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

export default function Index() {
  const { activeProposals, inactiveProposals } = useLoaderData<typeof loader>();

  return (
    <div className="mt-10 space-y-4">
      <Card className="pb-10">
        <CardHeader>
          <CardTitle>Active Standard Proposals</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col space-y-4">
            {activeProposals.map((proposal) => (
              <Link
                key={proposal.id}
                className="flex"
                to={$path("/app/proposals/:id", { id: proposal.id })}
              >
                <Button
                  className="flex flex-1 justify-between pr-4"
                  variant="outline"
                  data-testid={`proposal-${proposal.id}`}
                >
                  <span />
                  <span>{proposal.id}</span>
                  <ArrowRight />
                </Button>
              </Link>
            ))}
            {activeProposals.length === 0 && (
              <div className="text-center text-gray-500">No active standard proposals found.</div>
            )}
          </div>
        </CardContent>
      </Card>
      <Card className="pb-10">
        <CardHeader>
          <CardTitle>Inactive Standard Proposals</CardTitle>
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
            <div className="text-center text-gray-500">No inactive standard proposals found.</div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
