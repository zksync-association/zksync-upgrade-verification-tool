import { getProposalByExternalId } from "@/.server/db/dto/proposals";
import { getSignaturesByExternalProposalId } from "@/.server/db/dto/signatures";
import { councilAddress, guardiansAddress } from "@/.server/service/authorized-users";
import { calculateStatusPendingDays } from "@/.server/service/proposal-times";
import { getProposalData, getProposalStatus, nowInSeconds } from "@/.server/service/proposals";
import { getCheckReport, getStorageChangeReport } from "@/.server/service/reports";
import { validateAndSaveSignature } from "@/.server/service/signatures";
import { signActionSchema } from "@/common/sign-action";
import { StatusIndicator } from "@/components/status-indicator";
import TxLink from "@/components/tx-link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import Loading from "@/components/ui/loading";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import ContractWriteButton from "@/routes/app/proposals/$id/contract-write-button";
import ExecuteUpgradeButton from "@/routes/app/proposals/$id/execute-upgrade-button";
import FacetChangesTable from "@/routes/app/proposals/$id/facet-changes-table";
import FieldChangesTable from "@/routes/app/proposals/$id/field-changes-table";
import FieldStorageChangesTable from "@/routes/app/proposals/$id/field-storage-changes-table";
import ProposalState from "@/routes/app/proposals/$id/proposal-state";
import SignButton from "@/routes/app/proposals/$id/sign-button";
import SystemContractChangesTable from "@/routes/app/proposals/$id/system-contract-changes-table";
import { requireUserFromHeader } from "@/utils/auth-headers";
import { compareHexValues } from "@/utils/compare-hex-values";
import { badRequest, notFound } from "@/utils/http";
import { PROPOSAL_STATES } from "@/utils/proposal-states";
import { env } from "@config/env.server";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { defer, json } from "@remix-run/node";
import { Await, useLoaderData } from "@remix-run/react";
import { Suspense } from "react";
import { getFormData, getParams } from "remix-params-helper";
import { $path } from "remix-routes";
import { type Hex, isAddressEqual, zeroAddress } from "viem";
import { z } from "zod";
import { hexSchema } from "@/common/basic-schemas";

export async function loader({ request, params: remixParams }: LoaderFunctionArgs) {
  const user = requireUserFromHeader(request);

  const params = getParams(remixParams, z.object({ id: hexSchema }));
  if (!params.success) {
    throw notFound();
  }

  // Id is external_id coming from the smart contract
  const proposal = await getProposalByExternalId(params.data.id);
  if (!proposal) {
    throw notFound();
  }

  const getAsyncData = async () => {
    const checkReport = await getCheckReport(params.data.id);
    const storageChangeReport = await getStorageChangeReport(params.data.id);
    const [guardians, council, proposalStatus, signatures, proposalData] = await Promise.all([
      guardiansAddress(),
      councilAddress(),
      getProposalStatus(params.data.id),
      getSignaturesByExternalProposalId(params.data.id),
      getProposalData(params.data.id),
    ]);
    const upgradeHandler = env.UPGRADE_HANDLER_ADDRESS;

    return {
      proposal: {
        currentVersion: checkReport.metadata.currentVersion,
        proposedVersion: checkReport.metadata.proposedVersion,
        proposedOn: proposal.proposedOn,
        executor: proposal.executor,
        status: proposalStatus,
        statusTimes: calculateStatusPendingDays(
          proposalStatus,
          proposalData.creationTimestamp,
          proposalData.guardiansExtendedLegalVeto,
          await nowInSeconds()
        ),
        extendedLegalVeto: proposalData.guardiansExtendedLegalVeto,
        approvedByGuardians: proposalData.guardiansApproval,
        approvedByCouncil: proposalData.securityCouncilApprovalTimestamp !== 0,
        guardiansApproval: proposalData.guardiansApproval,
        guardiansExtendedLegalVeto: proposalData.guardiansExtendedLegalVeto,
        raw: proposal.calldata,
        signatures: {
          extendLegalVetoPeriod: signatures
            .filter((signature) => signature.action === "ExtendLegalVetoPeriod")
            .sort((a, b) => compareHexValues(a.signer, b.signer)),
          approveUpgradeGuardians: signatures
            .filter((signature) => signature.action === "ApproveUpgradeGuardians")
            .sort((a, b) => compareHexValues(a.signer, b.signer)),
          approveUpgradeSecurityCouncil: signatures
            .filter((signature) => signature.action === "ApproveUpgradeSecurityCouncil")
            .sort((a, b) => compareHexValues(a.signer, b.signer)),
        },
        transactionHash: proposal.transactionHash,
      },
      reports: {
        facetChanges: checkReport.facetChanges,
        systemContractChanges: checkReport.systemContractChanges,
        fieldChanges: checkReport.fieldChanges,
        fieldStorageChanges: storageChangeReport,
      },
      addresses: { guardians, council, upgradeHandler },
      userSignedProposal: signatures
        .filter((s) =>
          user.role === "guardian"
            ? s.action === "ApproveUpgradeGuardians"
            : s.action === "ApproveUpgradeSecurityCouncil"
        )
        .some((s) => isAddressEqual(s.signer as Hex, user.address as Hex)),
      userSignedLegalVeto: signatures
        .filter((s) => s.action === "ExtendLegalVetoPeriod")
        .some((s) => isAddressEqual(s.signer as Hex, user.address as Hex)),
    };
  };

  return defer({
    user,
    proposalId: proposal.externalId as Hex,
    asyncData: getAsyncData(),
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const user = requireUserFromHeader(request);
  const data = await getFormData(
    request,
    z.object({
      signature: hexSchema,
      proposalId: hexSchema,
      actionName: signActionSchema,
    })
  );
  if (!data.success) {
    throw badRequest("Failed to parse signature data");
  }

  await validateAndSaveSignature(
    data.data.signature,
    user.address as Hex,
    data.data.actionName,
    data.data.proposalId
  );
  return json({ ok: true });
}

const NECESSARY_SECURITY_COUNCIL_SIGNATURES = 6;
const NECESSARY_GUARDIAN_SIGNATURES = 5;
const NECESSARY_LEGAL_VETO_SIGNATURES = 2;

export default function Proposals() {
  const { user, asyncData, proposalId } = useLoaderData<typeof loader>();

  return (
    <div className="flex flex-1 flex-col space-y-4">
      <Suspense
        fallback={
          <div className="flex flex-1 flex-col items-center justify-center space-y-6">
            <Loading />
            <h2>Loading proposal...</h2>
          </div>
        }
      >
        <Await resolve={asyncData}>
          {({ addresses, proposal, reports, userSignedLegalVeto, userSignedProposal }) => {
            const securityCouncilSignaturesReached =
              proposal.signatures.approveUpgradeSecurityCouncil.length >=
              NECESSARY_SECURITY_COUNCIL_SIGNATURES;
            const guardiansSignaturesReached =
              proposal.signatures.approveUpgradeGuardians.length >= NECESSARY_GUARDIAN_SIGNATURES;

            const signProposalEnabled =
              !userSignedProposal &&
              [PROPOSAL_STATES.LegalVetoPeriod, PROPOSAL_STATES.Waiting].includes(
                proposal.status
              ) &&
              (user.role === "guardian" ? !proposal.guardiansApproval : true);
            const signLegalVetoEnabled =
              !userSignedLegalVeto &&
              !proposal.guardiansExtendedLegalVeto &&
              proposal.status === PROPOSAL_STATES.LegalVetoPeriod &&
              user.role === "guardian";

            const executeSecurityCouncilApprovalEnabled =
              proposal.status === PROPOSAL_STATES.Waiting && securityCouncilSignaturesReached;
            const executeGuardiansApprovalEnabled =
              !proposal.guardiansApproval &&
              proposal.status === PROPOSAL_STATES.Waiting &&
              guardiansSignaturesReached;
            const executeLegalVetoExtensionEnabled =
              !proposal.extendedLegalVeto && proposal.status === PROPOSAL_STATES.LegalVetoPeriod;
            const executeProposalEnabled =
              proposal.status === PROPOSAL_STATES.Ready &&
              (isAddressEqual(proposal.executor as Hex, user.address as Hex) ||
                isAddressEqual(proposal.executor as Hex, zeroAddress));

            return (
              <>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <Card className="pb-10">
                    <CardHeader>
                      <CardTitle>Proposal Details</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-6">
                        <div className="flex justify-between">
                          <span>Current Version:</span>
                          <span className="w-1/2 break-words text-right">
                            {proposal.currentVersion}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span>Proposed Version:</span>
                          <span className="w-1/2 break-words text-right">
                            {proposal.proposedVersion}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span>Proposal ID:</span>
                          <span className="w-1/2 justify-end break-words">{proposalId}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Proposed On:</span>
                          <div className="flex w-1/2 flex-col break-words text-right">
                            <span>{new Date(proposal.proposedOn).toISOString()}</span>
                            <span>
                              ({Math.floor(new Date(proposal.proposedOn).getTime() / 1000)})
                            </span>
                          </div>
                        </div>
                        <div className="flex justify-between">
                          <span>Executor:</span>
                          <span className="w-1/2 break-words text-right">
                            {isAddressEqual(proposal.executor as `0x${string}`, zeroAddress)
                              ? "Anyone"
                              : proposal.executor}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span>Transaction hash:</span>
                          <TxLink txid={proposal.transactionHash} />
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                  <Card className="pb-10">
                    <CardHeader className="pt-7">
                      <ProposalState status={proposal.status} times={proposal.statusTimes} />
                      <CardTitle>Proposal Status</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-5">
                        <StatusIndicator
                          label="Security Council Approvals"
                          signatures={proposal.signatures.approveUpgradeSecurityCouncil.length}
                          necessarySignatures={NECESSARY_SECURITY_COUNCIL_SIGNATURES}
                        />
                        <StatusIndicator
                          label="Guardian Approvals"
                          signatures={proposal.signatures.approveUpgradeGuardians.length}
                          necessarySignatures={NECESSARY_GUARDIAN_SIGNATURES}
                        />
                        <StatusIndicator
                          label="Extend Legal Veto Approvals"
                          signatures={proposal.signatures.extendLegalVetoPeriod.length}
                          necessarySignatures={NECESSARY_LEGAL_VETO_SIGNATURES}
                        />
                      </div>
                    </CardContent>
                  </Card>
                  <Card className="pb-10">
                    <CardHeader>
                      <CardTitle>
                        {user.role === "visitor" && "No role actions"}
                        {user.role === "guardian" && "Guardian Actions"}
                        {user.role === "securityCouncil" && "Security Council Actions"}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="flex flex-col space-y-3">
                      {user.role === "guardian" && (
                        <SignButton
                          proposalId={proposalId}
                          contractData={{
                            actionName: "ExtendLegalVetoPeriod",
                            address: addresses.guardians,
                            name: "Guardians",
                          }}
                          disabled={!signLegalVetoEnabled}
                          postAction={$path("/app/proposals/:id", { id: proposalId })}
                        >
                          Approve extend veto period
                        </SignButton>
                      )}
                      {user.role === "guardian" && (
                        <SignButton
                          proposalId={proposalId}
                          contractData={{
                            actionName: "ApproveUpgradeGuardians",
                            address: addresses.guardians,
                            name: "Guardians",
                          }}
                          disabled={!signProposalEnabled}
                          postAction={$path("/app/proposals/:id", { id: proposalId })}
                        >
                          Approve proposal
                        </SignButton>
                      )}
                      {user.role === "securityCouncil" && (
                        <SignButton
                          proposalId={proposalId}
                          contractData={{
                            actionName: "ApproveUpgradeSecurityCouncil",
                            address: addresses.council,
                            name: "SecurityCouncil",
                          }}
                          disabled={!signProposalEnabled}
                          postAction={$path("/app/proposals/:id", { id: proposalId })}
                        >
                          Approve proposal
                        </SignButton>
                      )}
                    </CardContent>
                  </Card>
                  <Card className="pb-10">
                    <CardHeader>
                      <CardTitle>Proposal Actions</CardTitle>
                    </CardHeader>
                    <CardContent className="flex flex-col space-y-3">
                      <ContractWriteButton
                        target={addresses.council}
                        signatures={proposal.signatures.approveUpgradeSecurityCouncil}
                        proposalId={proposalId}
                        functionName={"approveUpgradeSecurityCouncil"}
                        abiName="council"
                        threshold={NECESSARY_SECURITY_COUNCIL_SIGNATURES}
                        disabled={!executeSecurityCouncilApprovalEnabled}
                      >
                        Execute security council approval
                      </ContractWriteButton>

                      <ContractWriteButton
                        target={addresses.guardians}
                        signatures={proposal.signatures.approveUpgradeGuardians}
                        proposalId={proposalId}
                        functionName={"approveUpgradeGuardians"}
                        abiName="guardians"
                        threshold={NECESSARY_GUARDIAN_SIGNATURES}
                        disabled={!executeGuardiansApprovalEnabled}
                      >
                        Execute guardian approval
                      </ContractWriteButton>

                      <ContractWriteButton
                        target={addresses.guardians}
                        signatures={proposal.signatures.extendLegalVetoPeriod}
                        proposalId={proposalId}
                        functionName={"extendLegalVeto"}
                        abiName="guardians"
                        threshold={NECESSARY_LEGAL_VETO_SIGNATURES}
                        disabled={!executeLegalVetoExtensionEnabled}
                      >
                        Execute legal veto extension
                      </ContractWriteButton>
                      <ExecuteUpgradeButton
                        target={addresses.upgradeHandler}
                        proposalCalldata={proposal.raw}
                        disabled={!executeProposalEnabled}
                      >
                        Execute upgrade
                      </ExecuteUpgradeButton>
                    </CardContent>
                  </Card>
                </div>
                <div className="pt-4">
                  <h2 className="font-bold text-3xl">Upgrade Analysis</h2>
                  <Tabs className="mt-4 flex" defaultValue="facet-changes">
                    <TabsList className="mt-12 mr-6">
                      <TabsTrigger value="facet-changes">Facet Changes</TabsTrigger>
                      <TabsTrigger value="system-contract-changes">
                        System Contract Changes
                      </TabsTrigger>
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
              </>
            );
          }}
        </Await>
      </Suspense>
    </div>
  );
}
