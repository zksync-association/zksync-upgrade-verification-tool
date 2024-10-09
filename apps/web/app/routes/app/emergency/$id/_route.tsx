import { getEmergencyProposalCallsByProposalId } from "@/.server/db/dto/emergency-proposal-calls";
import { getEmergencyProposalByExternalId } from "@/.server/db/dto/emergency-proposals";
import { getSignaturesByEmergencyProposalId } from "@/.server/db/dto/signatures";
import { broadcastSuccess } from "@/.server/service/emergency-proposals";
import { SIGNATURE_FACTORIES } from "@/.server/service/signatures";
import HeaderWithBackButton from "@/components/proposal-header-with-back-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UpgradeRawData } from "@/components/upgrade-raw-data";
import { ExecuteEmergencyUpgradeButton } from "@/routes/app/emergency/$id/execute-emergency-upgrade-button";
import {
  GUARDIANS_COUNCIL_THRESHOLD,
  SEC_COUNCIL_THRESHOLD,
  ZK_FOUNDATION_THRESHOLD,
} from "@/utils/emergency-proposals";
import { extract, extractFromParams } from "@/utils/read-from-request";
import { badRequest, notFound } from "@/utils/http";
import { type ActionFunctionArgs, json, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { hexSchema } from "@repo/common/schemas";
import { isAddressEqual } from "viem";
import { z } from "zod";
import { requireUserFromRequest } from "@/utils/auth-headers";
import useUser from "@/components/hooks/use-user";
import { EmergencySignButton } from "@/routes/app/emergency/$id/emergency-sign-button";
import { emergencyUpgradeBoardAddress } from "@/.server/service/ethereum-l1/contracts/protocol-upgrade-handler";
import { zkFoundationAddress } from "@/.server/service/ethereum-l1/contracts/emergency-upgrade-board";
import { guardianMembers } from "@/.server/service/ethereum-l1/contracts/guardians";
import { securityCouncilMembers } from "@/.server/service/ethereum-l1/contracts/security-council";
import ZkAdminArchiveProposal from "@/components/zk-admin-archive-proposal";
import ProposalArchivedCard from "@/components/proposal-archived-card";
import { Meta } from "@/utils/meta";
import { displayBytes32 } from "@/utils/common-tables";
import { formatDateTime } from "@/utils/date";
import ExecuteActionsCard from "@/components/proposal-components/execute-actions-card";
import SignActionsCard from "@/components/proposal-components/sign-actions-card";
import VotingStatusIndicator from "@/components/voting-status-indicator";

export const meta = Meta["/app/emergency/:id"];

export async function loader(args: LoaderFunctionArgs) {
  const { id: proposalId } = extractFromParams(
    args.params,
    z.object({ id: hexSchema }),
    notFound()
  );

  const proposal = await getEmergencyProposalByExternalId(proposalId);
  if (proposal === undefined) {
    throw notFound();
  }

  const emergencyBoard = await emergencyUpgradeBoardAddress();
  const [zkFoundation, allGuardians, allSecurityCouncil, calls, signatures] = await Promise.all([
    zkFoundationAddress(emergencyBoard),
    guardianMembers(),
    securityCouncilMembers(),
    getEmergencyProposalCallsByProposalId(proposal.id),
    getSignaturesByEmergencyProposalId(proposal.externalId),
  ]);

  const securityCouncilSignatures = signatures.filter((sig) => {
    return allSecurityCouncil.some((addr) => isAddressEqual(addr, sig.signer));
  });
  const guardianSignatures = signatures.filter((sig) => {
    return allGuardians.some((addr) => isAddressEqual(addr, sig.signer));
  });
  const zkFoundationSignatures = signatures.filter((sig) => {
    return isAddressEqual(sig.signer, zkFoundation);
  });

  return json({
    calls,
    proposal: {
      id: proposal.id,
      title: proposal?.title,
      externalId: proposal.externalId,
      proposedOn: proposal.proposedOn,
      salt: proposal.salt,
      status: proposal.status,
      archivedOn: proposal.archivedOn,
      archivedReason: proposal.archivedReason,
      archivedBy: proposal.archivedBy,
    },
    addresses: {
      emergencyBoard,
      zkFoundation,
    },
    signatures: {
      securityCouncil: securityCouncilSignatures,
      guardian: guardianSignatures,
      zkFoundation: zkFoundationSignatures,
    },
    allGuardians,
    allSecurityCouncil,
  });
}

const intentParser = z.enum(["newSignature", "broadcastSuccess"]);

export async function action({ request }: ActionFunctionArgs) {
  const formData = await request.formData().catch(() => {
    throw badRequest("Failed to parse body");
  });

  const intent = extract(formData, "intent", intentParser);
  const proposalId = extract(formData, "proposalId", hexSchema);

  if (intent === intentParser.enum.newSignature) {
    const user = requireUserFromRequest(request);
    const signature = extract(formData, "signature", hexSchema);

    await SIGNATURE_FACTORIES.emergencyUpgrade(proposalId, user.address, signature);
  }

  if (intent === intentParser.enum.broadcastSuccess) {
    await broadcastSuccess(proposalId);
  }

  return json({ ok: true });
}

export default function EmergencyUpgradeDetails() {
  const { calls, proposal, addresses, signatures, allSecurityCouncil, allGuardians } =
    useLoaderData<typeof loader>();
  const user = useUser();

  const userAlreadySigned =
    signatures.securityCouncil.some((s) => isAddressEqual(s.signer, user.address)) ||
    signatures.guardian.some((s) => isAddressEqual(s.signer, user.address)) ||
    signatures.zkFoundation.some((s) => isAddressEqual(s.signer, user.address));

  const allSignatures = signatures.securityCouncil
    .concat(signatures.guardian)
    .concat(signatures.zkFoundation);

  const proposalArchived = proposal.archivedOn !== null;

  return (
    <div className="flex min-h-screen flex-col">
      <HeaderWithBackButton>
        Emergency Upgrade {displayBytes32(proposal.externalId)}
      </HeaderWithBackButton>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card data-testid="proposal-details-card">
          <CardHeader>
            <CardTitle>Emergency Upgrade Details</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-6">
              <div className="flex justify-between">
                <span>Title:</span>
                <span className="w-4/5 justify-end break-words text-right">{proposal.title}</span>
              </div>
              <div className="flex justify-between">
                <span>Emergency Upgrade ID:</span>
                <span className="w-3/5 justify-end break-words text-right">
                  {proposal.externalId}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Proposed On:</span>
                <span>{formatDateTime(proposal.proposedOn)}</span>
              </div>
              {proposalArchived && (
                <ProposalArchivedCard
                  archivedOn={new Date(proposal.archivedOn ?? 0)}
                  archivedReason={proposal.archivedReason ?? ""}
                  archivedBy={proposal.archivedBy ?? ""}
                />
              )}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pt-7">
            <p className="text-red-500">{proposalArchived ? "Archived" : "\u00A0"}</p>
            <CardTitle>Approval Status</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-5">
              <VotingStatusIndicator
                role="securityCouncil"
                signatures={signatures.securityCouncil.length}
                necessarySignatures={SEC_COUNCIL_THRESHOLD}
                signers={signatures.securityCouncil.map((s) => s.signer)}
              />
              <VotingStatusIndicator
                role="guardian"
                signatures={signatures.guardian.length}
                necessarySignatures={GUARDIANS_COUNCIL_THRESHOLD}
                signers={signatures.guardian.map((s) => s.signer)}
              />
              <VotingStatusIndicator
                role="zkFoundation"
                signatures={signatures.zkFoundation.length}
                necessarySignatures={ZK_FOUNDATION_THRESHOLD}
                signers={signatures.zkFoundation.map((s) => s.signer)}
              />
            </div>
          </CardContent>
        </Card>
        <SignActionsCard
          role={user.role}
          enabledRoles={["securityCouncil", "guardian", "zkFoundation", "zkAdmin"]}
        >
          {(user.role === "guardian" ||
            user.role === "securityCouncil" ||
            user.role === "zkFoundation") && (
            <EmergencySignButton
              proposalId={proposal.externalId}
              contractAddress={addresses.emergencyBoard}
              role={user.role}
              disabled={userAlreadySigned || proposalArchived}
            />
          )}
          {user.role === "zkAdmin" && (
            <ZkAdminArchiveProposal
              proposalId={BigInt(proposal.id)}
              proposalType="ArchiveEmergencyProposal"
              disabled={proposal.archivedOn !== null}
            />
          )}
        </SignActionsCard>
        <ExecuteActionsCard>
          <ExecuteEmergencyUpgradeButton
            boardAddress={addresses.emergencyBoard}
            gatheredSignatures={allSignatures}
            allGuardians={allGuardians}
            allCouncil={allSecurityCouncil}
            zkFoundationAddress={addresses.zkFoundation}
            proposal={proposal}
            calls={calls}
            disabled={proposalArchived}
          >
            Execute Emergency Upgrade
          </ExecuteEmergencyUpgradeButton>
        </ExecuteActionsCard>
      </div>

      <Tabs className="mt-4 flex" defaultValue="raw-data">
        <TabsList className="mt-12 mr-6">
          <TabsTrigger value="raw-data">Raw upgrade data</TabsTrigger>
          <TabsTrigger value="json">JSON</TabsTrigger>
        </TabsList>
        <TabsContent value="raw-data" className="w-full">
          <Card className="pb-8">
            <CardHeader>
              <CardTitle>Raw Data</CardTitle>
            </CardHeader>
            <CardContent className="pt-4">
              <UpgradeRawData calls={calls} salt={proposal.salt} />
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="json" className="w-full">
          <Card className="pb-8">
            <CardHeader>
              <CardTitle>JSON</CardTitle>
            </CardHeader>
            <CardContent className="pt-4">
              <pre className="text-wrap break-words">
                {JSON.stringify(
                  {
                    executor: addresses.emergencyBoard,
                    salt: proposal.salt,
                    calls: calls.map((c) => ({
                      target: c.target,
                      value: c.value,
                      data: c.data,
                    })),
                  },
                  null,
                  2
                )}
              </pre>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
