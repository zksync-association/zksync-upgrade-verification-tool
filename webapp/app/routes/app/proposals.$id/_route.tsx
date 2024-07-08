import { useAuth } from "@/components/context/auth-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { displayAddress } from "@/utils/address";
import { displayBytes32 } from "@/utils/bytes32";
import { notFound } from "@/utils/http";
import { type LoaderFunctionArgs, type SerializeFrom, json } from "@remix-run/node";
import { useLoaderData, useNavigate } from "@remix-run/react";
import { ArrowLeft } from "lucide-react";
import { getParams } from "remix-params-helper";
import { $path } from "remix-routes";
import { z } from "zod";

export const handle = {
  breadcrumb: (data: SerializeFrom<typeof loader>) => ({
    path: $path("/app/proposals/:id", { id: data.proposal.id }),
    label: displayBytes32(data.proposal.id),
  }),
};

export function loader({ params: remixParams }: LoaderFunctionArgs) {
  const params = getParams(remixParams, z.object({ id: z.string() }));
  if (params.success === false) {
    throw notFound();
  }
  return json({
    proposal: {
      id: params.data.id,
      version: "23",
      proposedBy: "0x23",
      proposedOn: "July 23, 2024",
    },
  });
}

export default function Proposals() {
  const { proposal } = useLoaderData<typeof loader>();
  const auth = useAuth();
  const navigate = useNavigate();

  return (
    <div className="mt-10 flex flex-col space-y-4">
      <div className="flex items-center pl-2">
        <Button
          size="icon"
          variant="ghost"
          onClick={() => navigate(-1)}
          className="mr-2 hover:bg-transparent"
        >
          <ArrowLeft />
        </Button>
        <h2 className="font-semibold">Proposal {displayBytes32(proposal.id)}</h2>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Proposal Details</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-6">
              <div className="flex justify-between">
                <span>Version:</span>
                <span className="w-1/2 break-words text-right">{proposal.version}</span>
              </div>
              <div className="flex justify-between">
                <span>Proposed By:</span>
                <span className="w-1/2 break-words text-right">{proposal.proposedBy}</span>
              </div>
              <div className="flex justify-between">
                <span>Proposal ID:</span>
                <span className="w-1/2 break-words text-right">{proposal.id}</span>
              </div>
              <div className="flex justify-between">
                <span>Proposed On:</span>
                <span className="w-1/2 break-words text-right">{proposal.proposedOn}</span>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pt-7">
            <p className="text-primary">ACTIVE</p>
            <CardTitle>Current Votes</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex justify-between">
                <span>Approve</span>
                <span className="text-muted-foreground">8/10</span>
              </div>
              <Progress value={80} />
              <div className="flex justify-between">
                <span>Abstain</span>
                <span className="text-muted-foreground">2</span>
              </div>
              <Progress value={20} />
              <div className="flex justify-between">
                <span>Reject</span>
                <span className="text-muted-foreground">2/6</span>
              </div>
              <Progress value={20} />
            </div>
          </CardContent>
          <CardFooter className="justify-end">
            <Button>Execute Transaction</Button>
          </CardFooter>
        </Card>
      </div>
      <Card className="py-10 text-center">
        <h3 className="">VOTING ENDS IN</h3>
        <p className="text-4xl">
          1 <span className="text-muted-foreground">day</span> : 23{" "}
          <span className="text-muted-foreground">hrs</span> : 10{" "}
          <span className="text-muted-foreground">mins</span> : 30{" "}
          <span className="text-muted-foreground">seconds</span>
        </p>
      </Card>
      <Card className="flex flex-col items-center space-y-4 pt-4 pb-10 text-center">
        <p className="font-bold">{auth.isAuthenticated && displayAddress(auth.address)}</p>
        <h3 className="text-3xl">
          <span className="font-semibold">Your Vote:</span> Pending
        </h3>
        <div className="flex space-x-4">
          <Button>Approve</Button>
          <Button>Abstain</Button>
          <Button>Reject</Button>
        </div>
      </Card>
      <div className="pt-4">
        <h2 className="font-bold text-3xl">Upgrade Analysis</h2>
        <Tabs className="mt-4 flex" defaultValue="facet-changes">
          <TabsList className="mt-12 mr-6">
            <TabsTrigger value="facet-changes">Facet Changes</TabsTrigger>
            <TabsTrigger value="system-contract-changes">System Contract Changes</TabsTrigger>
            <TabsTrigger value="field-changes">Field Changes</TabsTrigger>
            <TabsTrigger value="field-storage-changes">Field Storage Changes</TabsTrigger>
          </TabsList>
          <TabsContent value="facet-changes" className="flex-1">
            <Card>
              <CardHeader>
                <CardTitle>Facet Changes</CardTitle>
              </CardHeader>
              <CardContent>Facet Changes.</CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="system-contract-changes">
            <Card>
              <CardHeader>
                <CardTitle>System Contract Changes</CardTitle>
              </CardHeader>
              <CardContent>System Contract Changes.</CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="field-changes">
            <Card>
              <CardHeader>
                <CardTitle>Field Changes</CardTitle>
              </CardHeader>
              <CardContent>Field Changes.</CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="field-storage-changes">
            <Card>
              <CardHeader>
                <CardTitle>Field Storage Changes</CardTitle>
              </CardHeader>
              <CardContent>Field Storage Changes.</CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
