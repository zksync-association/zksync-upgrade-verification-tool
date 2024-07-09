import { getCheckReport, getProposal, getStorageChangeReport } from "@/.server/service/reports";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import FacetChangesTable from "@/routes/app/proposals.$id/facet-changes-table";
import FieldChangesTable from "@/routes/app/proposals.$id/field-changes-table";
import FieldStorageChangesTable from "@/routes/app/proposals.$id/field-storage-changes-table";
import SystemContractChangesTable from "@/routes/app/proposals.$id/system-contract-changes-table";
import { requireUserFromHeader } from "@/utils/auth-headers";
import { displayBytes32 } from "@/utils/bytes32";
import { notFound } from "@/utils/http";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useNavigate } from "@remix-run/react";
import { ArrowLeft } from "lucide-react";
import { getParams } from "remix-params-helper";
import { z } from "zod";

export async function loader({ request, params: remixParams }: LoaderFunctionArgs) {
  const user = requireUserFromHeader(request);
  const params = getParams(remixParams, z.object({ id: z.string() }));
  if (!params.success) {
    throw notFound();
  }

  const proposal = await getProposal(params.data.id);
  if (!proposal) {
    throw notFound();
  }

  const checkReport = await getCheckReport(params.data.id);
  const storageChangeReport = await getStorageChangeReport(params.data.id);
  return json({
    proposal: {
      id: params.data.id,
      version: "23",
      proposedBy: "0x23",
      proposedOn: "July 23, 2024",
    },
    reports: {
      facetChanges: checkReport.facetChanges,
      systemContractChanges: checkReport.systemContractChanges,
      fieldChanges: checkReport.fieldChanges,
      fieldStorageChanges: storageChangeReport,
    },
    user,
  });
}

export default function Proposals() {
  const { proposal, reports, user } = useLoaderData<typeof loader>();
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
        <Card className="pb-14">
          <CardHeader className="pt-7">
            <p className="text-orange-400">WAITING</p>
            <CardTitle>Proposal Status</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-5">
              {/* fixear espacio */}
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span>Security Council Approvals</span>
                  <span className="text-muted-foreground">5/6</span>
                </div>
                <Progress value={80} />
              </div>
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span>Guardian Approvals</span>
                  <span className="text-muted-foreground">2/5</span>
                </div>
                <Progress value={20} />
              </div>
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span>Extend Legal Veto Approvals</span>
                  <span className="text-muted-foreground">1/2</span>
                </div>
                <Progress value={50} />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="pb-10">
          <CardHeader>
            <CardTitle>
              {user.role === "guardian" ? "Guardian" : "Security Council"} Actions
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col space-y-3">
            <Button>Approve proposal</Button>
            {user.role === "guardian" && <Button>Approve veto extension</Button>}
          </CardContent>
        </Card>
        <Card className="pb-10">
          <CardHeader>
            <CardTitle>Proposal Actions</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col space-y-3">
            <Button>Execute security council approval</Button>
            <Button>Execute guardian approval</Button>
            <Button>Execute legal veto extension</Button>
            <Button>Execute upgrade</Button>
          </CardContent>
        </Card>
      </div>
      <div className="pt-4">
        <h2 className="font-bold text-3xl">Upgrade Analysis</h2>
        <Tabs className="mt-4 flex" defaultValue="facet-changes">
          <TabsList className="mt-12 mr-6">
            <TabsTrigger value="facet-changes">Facet Changes</TabsTrigger>
            <TabsTrigger value="system-contract-changes">System Contract Changes</TabsTrigger>
            <TabsTrigger value="field-changes">Field Changes</TabsTrigger>
            <TabsTrigger value="field-storage-changes">Field Storage Changes</TabsTrigger>
          </TabsList>
          <TabsContent value="facet-changes" className="w-full">
            <Card className="pb-8">
              <CardHeader>
                <CardTitle>Facet Changes</CardTitle>
              </CardHeader>
              <CardContent className="pt-4">
                <FacetChangesTable data={reports.facetChanges} />
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="system-contract-changes" className="w-full">
            <Card className="pb-8">
              <CardHeader>
                <CardTitle>System Contract Changes</CardTitle>
              </CardHeader>
              <CardContent className="pt-4">
                <SystemContractChangesTable data={reports.systemContractChanges} />
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="field-changes" className="w-full">
            <Card className="pb-8">
              <CardHeader>
                <CardTitle>Field Changes</CardTitle>
              </CardHeader>
              <CardContent className="pt-4">
                <FieldChangesTable data={reports.fieldChanges} />
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="field-storage-changes" className="w-full">
            <Card className="pb-8">
              <CardHeader>
                <CardTitle>Field Storage Changes</CardTitle>
              </CardHeader>
              <CardContent className="pt-4">
                <FieldStorageChangesTable data={reports.fieldStorageChanges} />{" "}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
