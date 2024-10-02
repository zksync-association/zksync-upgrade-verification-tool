import { getProposalByExternalId } from "@/.server/db/dto/proposals";
import { getSignaturesByExternalProposalId } from "@/.server/db/dto/signatures";
import { calculateStatusPendingDays } from "@/.server/service/proposal-times";
import { getLatestL1BlockTimestamp } from "@/.server/service/ethereum-l1/client";
import { SIGNATURE_FACTORIES } from "@/.server/service/signatures";
import HeaderWithBackButton from "@/components/proposal-header-with-back-button";
import TxLink from "@/components/tx-link";
import TxStatus from "@/components/tx-status";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import Loading from "@/components/ui/loading";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import VotingStatusIndicator from "@/components/voting-status-indicator";
import ContractWriteButton from "@/routes/app/proposals/$id/contract-write-button";
import ExecuteUpgradeButton from "@/routes/app/proposals/$id/execute-upgrade-button";
import ProposalState from "@/routes/app/proposals/$id/proposal-state";
import { RawStandardUpgrade } from "@/routes/app/proposals/$id/raw-standard-upgrade";
import { displayBytes32 } from "@/utils/common-tables";
import { compareHexValues } from "@/utils/compare-hex-values";
import { formatDateTime } from "@/utils/date";
import { notFound } from "@/utils/http";
import { PROPOSAL_STATES } from "@/utils/proposal-states";
import { env } from "@config/env.server";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { defer, json } from "@remix-run/node";
import { Await, useLoaderData } from "@remix-run/react";
import { hexSchema } from "@repo/common/schemas";
import { Suspense } from "react";
import { type Hex, isAddressEqual, zeroAddress } from "viem";
import { z } from "zod";
import { getFormDataOrThrow, extractFromParams } from "@/utils/read-from-request";
import { ApproveSignButton } from "@/routes/app/proposals/$id/approve-sign-button";
import { ExtendVetoButton } from "@/routes/app/proposals/$id/extend-veto-button";
import { requireUserFromRequest } from "@/utils/auth-headers";
import useUser from "@/components/hooks/use-user";
import { chooseByRole } from "@/common/user-role-schema";
import {
  getUpgradeState,
  getUpgradeStatus,
  guardiansAddress,
  securityCouncilAddress,
} from "@/.server/service/ethereum-l1/contracts/protocol-upgrade-handler";
import { EthereumConfig } from "@config/ethereum.server";
import { Meta } from "@/utils/meta";
import SignActionsCard from "@/components/proposal-components/sign-actions-card";
import ExecuteActionsCard from "@/components/proposal-components/execute-actions-card";

export const meta = Meta["/app/proposals/:id"];

export async function loader({ request, params: remixParams }: LoaderFunctionArgs) {
  const user = requireUserFromRequest(request);

  const { id } = extractFromParams(remixParams, z.object({ id: hexSchema }), notFound());

  // Id is external_id coming from the smart contract
  const proposal = await getProposalByExternalId(id);
  if (!proposal) {
    throw notFound();
  }

  const getAsyncData = async () => {
    const [guardians, council, proposalStatus, signatures, proposalData] = await Promise.all([
      guardiansAddress(),
      securityCouncilAddress(),
      getUpgradeState(id),
      getSignaturesByExternalProposalId(id),
      getUpgradeStatus(id),
    ]);
    const upgradeHandler = env.UPGRADE_HANDLER_ADDRESS;

    return {
      proposal: {
        proposedOn: proposal.proposedOn,
        executor: proposal.executor,
        status: proposalStatus,
        statusTimes: calculateStatusPendingDays(
          proposalStatus,
          proposalData.creationTimestamp,
          proposalData.guardiansExtendedLegalVeto,
          Number(await getLatestL1BlockTimestamp())
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
      addresses: {
        guardians,
        council,
        upgradeHandler,
      },
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
    proposalId: proposal.externalId as Hex,
    asyncData: getAsyncData(),
    transactionUrl: proposal.transactionHash
      ? EthereumConfig.getTransactionUrl(proposal.transactionHash)
      : "",
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const user = requireUserFromRequest(request);
  const data = await getFormDataOrThrow(request, {
    signature: hexSchema,
    proposalId: hexSchema,
    intent: z.enum(["approve", "extendVeto"], { message: "Unknown intent" }),
  });

  if (data.intent === "approve") {
    await SIGNATURE_FACTORIES.regularUpgrade(data.proposalId, user.address, data.signature);
  }

  if (data.intent === "extendVeto") {
    await SIGNATURE_FACTORIES.extendVetoPeriod(data.proposalId, user.address, data.signature);
  }

  return json({ ok: true });
}

const NECESSARY_SECURITY_COUNCIL_SIGNATURES = 6;
const NECESSARY_GUARDIAN_SIGNATURES = 5;
const NECESSARY_LEGAL_VETO_SIGNATURES = 2;

export default function Proposals() {
  const { asyncData, proposalId, transactionUrl } = useLoaderData<typeof loader>();
  const user = useUser();

  return (
    <div className="flex flex-1 flex-col">
      <HeaderWithBackButton>Upgrade {displayBytes32(proposalId)}</HeaderWithBackButton>
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
            {({ addresses, proposal, userSignedLegalVeto, userSignedProposal }) => {
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

              const signAddress = chooseByRole(
                user.role,
                () => addresses.guardians,
                () => addresses.council,
                () => {
                  throw new Error(`Role "${user.role}" cannot sign`);
                }
              );

              return (
                <>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <Card data-testid="proposal-details-card">
                      <CardHeader>
                        <CardTitle>Upgrade Details</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-6">
                          <div className="flex justify-between">
                            <span>Upgrade ID:</span>
                            <span className="w-1/2 justify-end break-words">{proposalId}</span>
                          </div>
                          <div className="flex justify-between">
                            <span>Proposed On:</span>
                            <span>{formatDateTime(proposal.proposedOn)}</span>
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
                            <div className="flex flex-1 flex-col items-end space-y-1">
                              <TxLink hash={proposal.transactionHash} url={transactionUrl} />
                              <TxStatus hash={proposal.transactionHash} />
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardHeader className="pt-7">
                        <ProposalState status={proposal.status} times={proposal.statusTimes} />
                        <CardTitle>Approval Status</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-5">
                          <VotingStatusIndicator
                            label="Extend Legal Veto Approvals"
                            signatures={proposal.signatures.extendLegalVetoPeriod.length}
                            necessarySignatures={NECESSARY_LEGAL_VETO_SIGNATURES}
                            testId="legal-veto-signature-count"
                          />
                          <VotingStatusIndicator
                            label="Security Council Approvals"
                            signatures={proposal.signatures.approveUpgradeSecurityCouncil.length}
                            necessarySignatures={NECESSARY_SECURITY_COUNCIL_SIGNATURES}
                            testId="council-signature-count"
                          />
                          <VotingStatusIndicator
                            label="Guardian Approvals"
                            signatures={proposal.signatures.approveUpgradeGuardians.length}
                            necessarySignatures={NECESSARY_GUARDIAN_SIGNATURES}
                            testId="guardian-signature-count"
                          />
                        </div>
                      </CardContent>
                    </Card>
                    <SignActionsCard
                      role={user.role}
                      enabledRoles={["guardian", "securityCouncil"]}
                    >
                      {user.role === "guardian" && (
                        <ExtendVetoButton
                          proposalId={proposalId}
                          contractAddress={addresses.guardians}
                          disabled={!signLegalVetoEnabled}
                        />
                      )}
                      {(user.role === "guardian" || user.role === "securityCouncil") && (
                        <ApproveSignButton
                          proposalId={proposalId}
                          role={user.role}
                          contractAddress={signAddress()}
                          disabled={!signProposalEnabled}
                        />
                      )}
                    </SignActionsCard>
                    <ExecuteActionsCard>
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
                      <ExecuteUpgradeButton
                        target={addresses.upgradeHandler}
                        proposalCalldata={proposal.raw}
                        disabled={!executeProposalEnabled}
                      >
                        Execute upgrade
                      </ExecuteUpgradeButton>
                    </ExecuteActionsCard>
                  </div>
                  <div className="pt-4">
                    <h2 className="font-bold text-3xl">Upgrade Analysis</h2>
                    <Tabs className="mt-4 flex" defaultValue="raw-data">
                      <TabsList className="mt-12 mr-6">
                        <TabsTrigger value="raw-data">Raw Data</TabsTrigger>
                      </TabsList>
                      <TabsContent value="raw-data" className="w-full">
                        <Card className="pb-8">
                          <CardHeader>
                            <CardTitle>Raw Data</CardTitle>
                          </CardHeader>
                          <CardContent className="pt-4">
                            <RawStandardUpgrade encoded={proposal.raw} />
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
    </div>
  );
}
