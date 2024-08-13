import { getCallsByProposalId } from "@/.server/db/dto/calls";
import { getEmergencyProposalByExternalId } from "@/.server/db/dto/emergencyProposals";
import { getSignaturesByEmergencyProposalId } from "@/.server/db/dto/signatures";
import {
  councilMembers,
  emergencyBoardAddress,
  guardianMembers,
  zkFoundationAddress,
} from "@/.server/service/authorized-users";
import { broadcastSuccess } from "@/.server/service/emergency-proposals";
import { saveEmergencySignature } from "@/.server/service/signatures";
import { hexSchema } from "@/common/basic-schemas";
import { type SignAction, signActionSchema } from "@/common/sign-action";
import { type UserRole, UserRoleSchema } from "@/common/user-role-schema";
import { StatusIndicator } from "@/components/status-indicator";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ExecuteEmergencyUpgradeButton } from "@/routes/app/emergency/$id/execute-emergency-upgrade-button";
import SignButton from "@/routes/app/proposals/$id/sign-button";
import { requireUserFromHeader } from "@/utils/auth-headers";
import {
  GUARDIANS_COUNCIL_THRESHOLD,
  SEC_COUNCIL_THRESHOLD,
  ZK_FOUNDATION_THRESHOLD,
} from "@/utils/emergency-proposals";
import { badRequest, notFound } from "@/utils/http";
import { type ActionFunctionArgs, type LoaderFunctionArgs, json } from "@remix-run/node";
import { useLoaderData, useNavigate } from "@remix-run/react";
import { ArrowLeft } from "lucide-react";
import { getParams } from "remix-params-helper";
import { $path } from "remix-routes";
import { type Hex, formatEther, hexToBigInt, isAddressEqual } from "viem";
import { type ZodTypeAny, z } from "zod";

export async function loader(args: LoaderFunctionArgs) {
  const user = requireUserFromHeader(args.request);
  const params = getParams(args.params, z.object({ id: hexSchema }));
  if (!params.success) {
    throw notFound();
  }

  const { id: proposalId } = params.data;

  const boardAddress = await emergencyBoardAddress();

  const proposal = await getEmergencyProposalByExternalId(proposalId);

  if (proposal === undefined) {
    throw notFound();
  }

  const calls = await getCallsByProposalId(proposal.id);

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

function extract<T extends ZodTypeAny>(
  formData: FormData,
  key: string,
  parser: T
): z.infer<typeof parser> {
  const value = formData.get(key);
  const parsed = parser.safeParse(value);
  if (parsed.error) {
    throw badRequest(`Wrong value for ${key}`);
  }
  return parsed.data;
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
    const actionName = extract(formData, "actionName", signActionSchema);

    await saveEmergencySignature(signature, user.address, actionName, proposalId);
  }

  if (intent === intentParser.enum.broadcastSuccess) {
    await broadcastSuccess(proposalId);
  }

  return json({ ok: true });
}

const ACTION_NAMES = {
  guardian: signActionSchema.enum.ExecuteEmergencyUpgradeGuardians,
  securityCouncil: signActionSchema.enum.ExecuteEmergencyUpgradeSecurityCouncil,
  zkFoundation: signActionSchema.enum.ExecuteEmergencyUpgradeZKFoundation,
};

function actionForRole(role: UserRole): SignAction {
  if (role === UserRoleSchema.enum.visitor) {
    throw new Error("Visitors are not allowed to sign emergency upgrades");
  }

  return ACTION_NAMES[role];
}

export default function EmergencyUpgradeDetails() {
  const navigate = useNavigate();

  const { calls, user, proposal, addresses, signatures, allSecurityCouncil, allGuardians } =
    useLoaderData<typeof loader>();

  if (user.role === "visitor") {
    return "Unauthorized: Only valid signers can see this page.";
  }

  const actionName = actionForRole(user.role);
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
    <div className="flex min-h-screen flex-col pt-10">
      <div className="mb-4 flex items-center pl-2">
        <Button
          size="icon"
          variant="ghost"
          onClick={() => navigate(-1)}
          className="mr-2 hover:bg-transparent"
        >
          <ArrowLeft />
        </Button>
        <h2 className="font-semibold">Proposal {proposal.externalId}</h2>
      </div>

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
                label="ZkFoundation approvals"
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
            <SignButton
              proposalId={proposal.externalId}
              contractData={{
                actionName: actionName,
                address: addresses.emergencyBoard,
                name: "EmergencyUpgradeBoard",
              }}
              disabled={haveAlreadySigned}
              postAction={$path("/app/emergency/:id", { id: proposal.externalId })}
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
              <p className="pb-10">
                <b>salt:</b> <span>{proposal.salt}</span>
              </p>

              <h3 className="font-bold text-xl">Calls</h3>

              {calls.map((call) => (
                <div
                  key={call.target + call.target + call.value}
                  className="mt-10 grid grid-cols-4 gap-y-3 border-t-2 pt-5"
                >
                  <div className="grid-col-span-1">Target</div>
                  <div className="col-span-3 font-mono">
                    <span className="break-words">{call.target}</span>
                  </div>

                  <div className="grid-col-span-1">Data</div>
                  <div className="col-span-3 font-mono">
                    <span className="break-words">{call.data}</span>
                  </div>

                  <div className="grid-col-span-1">Value</div>
                  <div className="col-span-3 font-mono">
                    <span className="break-words">{formatEther(hexToBigInt(call.value))}</span>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
