import { getEmergencyProposalCallsByProposalId } from "@/.server/db/dto/emergency-proposal-calls";
import { getEmergencyProposalByExternalId } from "@/.server/db/dto/emergency-proposals";
import { getSignaturesByEmergencyProposalId } from "@/.server/db/dto/signatures";
import {
  councilMembers,
  emergencyBoardAddress,
  guardianMembers,
  zkFoundationAddress,
} from "@/.server/service/authorized-users";
import { broadcastSuccess } from "@/.server/service/emergency-proposals";
import { SIGNATURE_FACTORIES } from "@/.server/service/signatures";
import HeaderWithBackButton from "@/components/proposal-header-with-back-button";
import { StatusIndicator } from "@/components/status-indicator";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UpgradeRawData } from "@/components/upgrade-raw-data";
import { ExecuteEmergencyUpgradeButton } from "@/routes/app/emergency/$id/execute-emergency-upgrade-button";
import SignButton from "@/routes/app/proposals/$id/sign-button";
import { requireUserFromHeader } from "@/utils/auth-headers";
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
import { $path } from "remix-routes";
import { type Hex, isAddressEqual } from "viem";
import { z } from "zod";
import { emergencyUpgradeActionForRole } from "@/common/user-role-schema";

export async function loader(args: LoaderFunctionArgs) {
  const user = requireUserFromHeader(args.request);
  const { id: proposalId } = extractFromParams(
    args.params,
    z.object({ id: hexSchema }),
    notFound()
  );

  const boardAddress = await emergencyBoardAddress();

  const proposal = await getEmergencyProposalByExternalId(proposalId);

  if (proposal === undefined) {
    throw notFound();
  }

  const calls = await getEmergencyProposalCallsByProposalId(proposal.id);

  const signatures = await getSignaturesByEmergencyProposalId(proposal.externalId);

  return json({
    calls: calls,
    proposal: {
      title: proposal?.title,
      externalId: proposal.externalId,
      proposedOn: proposal.proposedOn,
      salt: proposal.salt,
      status: proposal.status,
    },
    addresses: {
      emergencyBoard: boardAddress,
      zkFoundation: await zkFoundationAddress(),
    },
    user,
    signatures,
    allGuardians: await guardianMembers(),
    allSecurityCouncil: await councilMembers(),
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
    const user = requireUserFromHeader(request);
    const signature = extract(formData, "signature", hexSchema);

    await SIGNATURE_FACTORIES.emergencyUpgrade(proposalId, user.address, signature);
  }

  if (intent === intentParser.enum.broadcastSuccess) {
    await broadcastSuccess(proposalId);
  }

  return json({ ok: true });
}

export default function EmergencyUpgradeDetails() {
  const { calls, user, proposal, addresses, signatures, allSecurityCouncil, allGuardians } =
    useLoaderData<typeof loader>();

  const haveAlreadySigned = signatures.some((s) => isAddressEqual(s.signer, user.address as Hex));
  const gatheredScSignatures = signatures.filter((sig) => {
    return allSecurityCouncil.some((addr) => isAddressEqual(addr, sig.signer));
  }).length;
  const gatheredGuardianSignatures = signatures.filter((sig) => {
    return allGuardians.some((addr) => isAddressEqual(addr, sig.signer));
  }).length;
  const gatheredZkFoundationSignatures = signatures.filter((s) =>
    isAddressEqual(s.signer, addresses.zkFoundation)
  ).length;
  return (
    <div className="flex min-h-screen flex-col">
      <HeaderWithBackButton>Proposal {proposal.externalId}</HeaderWithBackButton>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card className="pb-10">
          <CardHeader>
            <CardTitle>Proposal Details</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-6">
              <div className="flex justify-between">
                <span>Title:</span>
                <span className="w-4/5 justify-end break-words text-right">{proposal.title}</span>
              </div>
              <div className="flex justify-between">
                <span>Proposal ID:</span>
                <span className="w-4/5 justify-end break-words text-right">
                  {proposal.externalId}
                </span>
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
                signatures={gatheredScSignatures}
                necessarySignatures={SEC_COUNCIL_THRESHOLD}
              />
              <StatusIndicator
                label="Guardian Approvals"
                signatures={gatheredGuardianSignatures}
                necessarySignatures={GUARDIANS_COUNCIL_THRESHOLD}
              />
              <StatusIndicator
                label="ZkFoundation Approval"
                signatures={gatheredZkFoundationSignatures}
                necessarySignatures={ZK_FOUNDATION_THRESHOLD}
              />
            </div>
          </CardContent>
        </Card>
        <Card className="pb-10">
          <CardHeader>
            <CardTitle>Signatures</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col space-y-3">
            {user.role !== "visitor" && (
              <SignButton
                proposalId={proposal.externalId}
                contractData={{
                  actionName: emergencyUpgradeActionForRole(user.role),
                  address: addresses.emergencyBoard,
                  name: "EmergencyUpgradeBoard",
                }}
                disabled={haveAlreadySigned}
                postAction={$path("/app/emergency/:id", { id: proposal.externalId })}
                intent={"approve"}
              >
                Approve
              </SignButton>
            )}
            {user.role === "visitor" && <p>No signing actions</p>}
          </CardContent>
        </Card>
        <Card className="pb-10">
          <CardHeader>
            <CardTitle>Broadcast actions</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col space-y-3">
            <ExecuteEmergencyUpgradeButton
              boardAddress={addresses.emergencyBoard}
              gatheredSignatures={signatures}
              allGuardians={allGuardians}
              allCouncil={allSecurityCouncil}
              zkFoundationAddress={addresses.zkFoundation}
              proposal={proposal}
              calls={calls}
            >
              Execute upgrade
            </ExecuteEmergencyUpgradeButton>
          </CardContent>
        </Card>
      </div>

      <Tabs className="mt-4 flex" defaultValue="raw-data">
        <TabsList className="mt-12 mr-6">
          <TabsTrigger value="raw-data">Raw upgrade data</TabsTrigger>
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
      </Tabs>
    </div>
  );
}
