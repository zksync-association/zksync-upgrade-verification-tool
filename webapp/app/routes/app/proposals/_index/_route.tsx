import { type Proposal, getProposals } from "@/.server/service/proposals";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import Loading from "@/components/ui/loading";
import { PROPOSAL_STATES } from "@/utils/proposal-states";
import { Await, Link, defer, useLoaderData } from "@remix-run/react";
import { ArrowRight } from "lucide-react";
import { Suspense } from "react";
import { $path } from "remix-routes";

const isProposalActive = (p: Proposal) =>
  p.state !== PROPOSAL_STATES.Expired && p.state !== PROPOSAL_STATES.Done;
const isProposalInactive = (p: Proposal) => !isProposalActive(p);

export function loader() {
  const getFilteredProposals = async () => {
    const proposals = await getProposals();
    return {
      active: proposals.filter(isProposalActive),
      inactive: proposals.filter(isProposalInactive),
    };
  };
  return defer({
    proposals: getFilteredProposals(),
  });
}

export default function Index() {
  const { proposals } = useLoaderData<typeof loader>();

  return (
    <div className="flex flex-col flex-1 space-y-4">
      <Suspense
        fallback={
          <div className="flex flex-1 flex-col items-center justify-center space-y-6 pb-4">
            <Loading className="h-16 w-16" />
            <h2>Fetching on-chain data for standard upgrade proposals...</h2>
          </div>
        }
      >
        <Await resolve={proposals}>
          {({ active: activeProposals, inactive: inactiveProposals }) => (
            <>
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
                        <Button className="flex flex-1 justify-between pr-4" variant="outline">
                          <span />
                          <span>{proposal.id}</span>
                          <ArrowRight />
                        </Button>
                      </Link>
                    ))}
                    {activeProposals.length === 0 && (
                      <div className="text-center text-gray-500">
                        No active standard proposals found.
                      </div>
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
                    <div className="text-center text-gray-500">
                      No inactive standard proposals found.
                    </div>
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </Await>
      </Suspense>
    </div>
  );
}
