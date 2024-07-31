import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusIndicator } from "@/components/status-indicator";
import { Button } from "@/components/ui/button";
import { displayBytes32 } from "@/routes/app/proposals/$id/common-tables";
import { ArrowLeft } from "lucide-react";
import { useLoaderData, useNavigate } from "@remix-run/react";
import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { getParams } from "remix-params-helper";
import { z } from "zod";
import { zodHex } from "validate-cli";
import { notFound } from "@/utils/http";
import { createOrIgnoreEmergencyProposal, getEmergencyProposalByExternalId } from "@/.server/db/dto/emergencyProposals";
import { zeroAddress } from "viem";
import SignButton from "@/routes/app/proposals/$id/sign-button";
import { emergencyBoardAddress } from "@/.server/service/authorized-users";

export async function loader(args: LoaderFunctionArgs) {
  const params = getParams(args.params, z.object({ id: zodHex }));
  if (!params.success) {
    throw notFound();
  }

  const { id: proposalId } = params.data

  const boardAddress = await emergencyBoardAddress()

  const maybeProposal = await getEmergencyProposalByExternalId(proposalId)
  const proposal = maybeProposal === undefined
    ? await createOrIgnoreEmergencyProposal({
      externalId: proposalId,
      calls: "0x0001",
      checkReport: null,
      storageDiffReport: null,
      proposedOn: new Date(),
      proposer: zeroAddress,
      transactionHash: "0x01"
    })
    : maybeProposal

  return json({
    proposal: proposal,
    addresses: {
      emergencyBoard: boardAddress
    }
  })
}

export default function EmergencyUpgradeDetails() {
  const navigate = useNavigate();

  const loaderData = useLoaderData<typeof loader>();
  const proposal = loaderData.proposal
  const addresses = loaderData.addresses
  return (
    <>
      <div className="mt-10 flex flex-1 flex-col">
        <div className="mb-4 flex items-center pl-2">
          <Button
            size="icon"
            variant="ghost"
            onClick={() => navigate(-1)}
            className="mr-2 hover:bg-transparent"
          >
            <ArrowLeft />
          </Button>
          <h2 className="font-semibold">
            Proposal{" "}
            {displayBytes32("0x967063a9ce441cdbf1ac4262f9d8152b96c6080144a1d5cb7b058dea70d01d02")}
          </h2>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card className="pb-10">
          <CardHeader>
            <CardTitle>Proposal Details</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-6">
              {/*<div className="flex justify-between">*/}
              {/*  <span>Current Version:</span>*/}
              {/*  <span className="w-1/2 break-words text-right">current version</span>*/}
              {/*</div>*/}
              {/*<div className="flex justify-between">*/}
              {/*  <span>Proposed Version:</span>*/}
              {/*  <span className="w-1/2 break-words text-right">new version</span>*/}
              {/*</div>*/}
              <div className="flex justify-between">
                <span>Proposal ID:</span>
                <span className="w-4/5 justify-end break-words text-right">{loaderData.proposal.externalId}</span>
              </div>
              <div className="flex justify-between">
                <span>Proposed On:</span>
                <div className="flex w-3/4 flex-col break-words text-right">
                  <span>{new Date(proposal.proposedOn).toLocaleDateString()}</span>
                  <span>{new Date(proposal.proposedOn).toLocaleTimeString()}</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="pb-10">
          <CardHeader className="pt-7">
            <CardTitle>Proposal Status</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-5">
              <StatusIndicator
                label="Security Council Approvals"
                signatures={1}
                necessarySignatures={6}
              />
              <StatusIndicator label="Guardian Approvals" signatures={1} necessarySignatures={5} />
              <StatusIndicator
                label="ZkFoundation approvals"
                signatures={0}
                necessarySignatures={1}
              />
            </div>
          </CardContent>
        </Card>
        <Card className="pb-10">
          <CardHeader>
            <CardTitle>Signatures</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col space-y-3">
            <SignButton
              proposalId={proposal.externalId}
              contractData={{
                actionName: "ExecuteEmergencyUpgradeGuardians",
                address: addresses.emergencyBoard,
                name: "EmergencyUpgradeBoard",
              }}
              disabled={true}
            >
              Approve
            </SignButton>
          </CardContent>
        </Card>
        <Card className="pb-10">
          <CardHeader>
            <CardTitle>Broadcast actions</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col space-y-3">
            <Button>Execute upgrade</Button>
            {/*<ContractWriteButton*/}
            {/*  target={addresses.guardians}*/}
            {/*  signatures={proposal.signatures.extendLegalVetoPeriod}*/}
            {/*  proposalId={proposalId}*/}
            {/*  functionName={"extendLegalVeto"}*/}
            {/*  abiName="guardians"*/}
            {/*  threshold={NECESSARY_LEGAL_VETO_SIGNATURES}*/}
            {/*  disabled={!executeLegalVetoExtensionEnabled}*/}
            {/*>*/}
            {/*  Execute legal veto extension*/}
            {/*</ContractWriteButton>*/}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
