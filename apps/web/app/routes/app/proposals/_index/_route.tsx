import { getProposals } from "@/.server/service/proposals";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import Loading from "@/components/ui/loading";
import { Await, Link, defer, useLoaderData } from "@remix-run/react";
import { ArrowRight } from "lucide-react";
import { Suspense } from "react";
import { $path } from "remix-routes";
import { PlusIcon } from "@radix-ui/react-icons";

export function loader() {
  const getFilteredProposals = async () => {
    const proposals = await getProposals();
    return {
      active: proposals.filter((p) => p.status === "ACTIVE"),
      inactive: proposals.filter((p) => p.status === "INACTIVE"),
    };
  };
  return defer({
    proposals: getFilteredProposals(),
  });
}

export default function Index() {
  const { proposals } = useLoaderData<typeof loader>();

  return (
    <div className="flex flex-1 flex-col space-y-4">
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
                  <div className="flex items-center justify-between">
                    <CardTitle>Active Standard Proposals</CardTitle>
                    <a href={$path("/app/proposals/new")}>
                      <Button data-testid="start-regular-ugprade" variant="secondary" size="icon">
                        <PlusIcon className="h-4 w-4"/>
                      </Button>
                    </a>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-col space-y-4">
                    {activeProposals.map((proposal) => (
                      <Link
                        key={proposal.externalId}
                        className="flex"
                        to={$path("/app/proposals/:id", { id: proposal.externalId })}
                      >
                        <Button className="flex flex-1 justify-between pr-4" variant="outline">
                          <span />
                          <span>{proposal.externalId}</span>
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
                        key={proposal.externalId}
                        className="flex"
                        to={$path("/app/proposals/:id", { id: proposal.externalId })}
                      >
                        <Button className="flex flex-1 justify-between pr-4" variant="outline">
                          <span />
                          <span>{proposal.externalId}</span>
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
