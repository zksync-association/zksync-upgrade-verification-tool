import { getFreezeProposalById } from "@/.server/db/dto/freeze-proposals";
import { getSignaturesByFreezeProposalId } from "@/.server/db/dto/signatures";
import {
  councilAddress,
  councilHardFreezeThreshold,
  councilSetSoftFreezeThresholdThreshold,
  councilSoftFreezeThreshold,
  councilUnfreezeThreshold,
} from "@/.server/service/contracts";
import { validateAndSaveFreezeSignature } from "@/.server/service/signatures";
import { type SignAction, signActionSchema } from "@/common/sign-action";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import VotingStatusIndicator from "@/components/voting-status-indicator";
import ContractWriteButton from "@/routes/app/freeze_.$id/contract-write-button";
import SignButton from "@/routes/app/freeze_.$id/sign-button";
import { requireUserFromHeader } from "@/utils/auth-headers";
import { badRequest, notFound } from "@/utils/http";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, useLoaderData, useNavigate } from "@remix-run/react";
import { ArrowLeft } from "lucide-react";
import { getFormData, getParams } from "remix-params-helper";
import { zodHex } from "validate-cli";
import { type Hex, isAddressEqual } from "viem";
import { z } from "zod";

export async function loader({ request, params: remixParams }: LoaderFunctionArgs) {
  const user = requireUserFromHeader(request);

  const params = getParams(remixParams, z.object({ id: z.coerce.number() }));
  if (!params.success) {
    throw notFound();
  }

  const proposal = await getFreezeProposalById(params.data.id);
  if (!proposal) {
    throw notFound();
  }

  const signatures = await getSignaturesByFreezeProposalId(proposal.id);

  let currentSoftFreezeThreshold: bigint | undefined;
  if (proposal.type === "SET_SOFT_FREEZE_THRESHOLD") {
    currentSoftFreezeThreshold = await councilSoftFreezeThreshold();
  }

  let necessarySignatures: number;
  switch (proposal.type) {
    case "SOFT_FREEZE":
      necessarySignatures = Number(await councilSoftFreezeThreshold());
      break;
    case "HARD_FREEZE":
      necessarySignatures = Number(await councilHardFreezeThreshold());
      break;
    case "SET_SOFT_FREEZE_THRESHOLD":
      necessarySignatures = Number(await councilSetSoftFreezeThresholdThreshold());
      break;
    case "UNFREEZE":
      necessarySignatures = Number(await councilUnfreezeThreshold());
      break;
  }

  return json({
    proposal,
    currentSoftFreezeThreshold,
    signatures,
    necessarySignatures,
    user,
    securityCouncilAddress: await councilAddress(),
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const user = requireUserFromHeader(request);
  const data = await getFormData(
    request,
    z.object({
      signature: zodHex,
      proposalId: z.number(),
      action: signActionSchema,
    })
  );
  if (!data.success) {
    throw badRequest("Failed to parse signature data");
  }

  const proposal = await getFreezeProposalById(data.data.proposalId);
  if (!proposal) {
    throw badRequest("Proposal not found");
  }

  await validateAndSaveFreezeSignature({
    action: data.data.action,
    proposal,
    signature: data.data.signature,
    signer: user.address as Hex,
  });
  return json({ ok: true });
}

export default function Freeze() {
  const navigate = useNavigate();
  const {
    proposal,
    currentSoftFreezeThreshold,
    signatures,
    necessarySignatures,
    user,
    securityCouncilAddress,
  } = useLoaderData<typeof loader>();

  let proposalType: string;
  let action: SignAction;
  switch (proposal.type) {
    case "SOFT_FREEZE":
      proposalType = "Soft Freeze";
      action = "ApproveSoftFreeze";
      break;
    case "HARD_FREEZE":
      proposalType = "Hard Freeze";
      action = "ApproveHardFreeze";
      break;
    case "SET_SOFT_FREEZE_THRESHOLD":
      proposalType = "Set Soft Freeze Threshold";
      action = "ApproveSetSoftFreezeThreshold";
      break;
    case "UNFREEZE":
      proposalType = "Unfreeze";
      action = "ApproveUnfreeze";
      break;
  }

  const signDisabled =
    user.role !== "securityCouncil" ||
    signatures.some((s) => isAddressEqual(s.signer, user.address as Hex));

  const executeFreezeEnabled = signatures.length >= necessarySignatures;

  return (
    <div className="mt-10 flex flex-1 flex-col">
      <div className="flex items-center pl-2">
        <Button
          size="icon"
          variant="ghost"
          onClick={() => navigate(-1)}
          className="mr-2 hover:bg-transparent"
        >
          <ArrowLeft />
        </Button>
        <h2 className="font-semibold">
          {proposalType} Proposal {proposal.externalId}
        </h2>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card className="pb-10">
          <CardHeader>
            <CardTitle>Proposal Details</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-6">
              {proposal.type === "SET_SOFT_FREEZE_THRESHOLD" && (
                <>
                  <div className="flex justify-between">
                    <span>Current Threshold:</span>
                    <span className="w-1/2 break-words text-right">
                      {currentSoftFreezeThreshold}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>New Threshold:</span>
                    <span className="w-1/2 break-words text-right">
                      {proposal.softFreezeThreshold}
                    </span>
                  </div>
                </>
              )}
              <div className="flex justify-between">
                <span>Valid Until:</span>
                <div className="flex w-1/2 flex-col break-words text-right">
                  <span>{new Date(proposal.validUntil).toLocaleString()}</span>
                  <span>({Math.floor(new Date(proposal.validUntil).getTime() / 1000)})</span>
                </div>
              </div>
              <div className="flex justify-between">
                <span>Proposed On:</span>
                <div className="flex w-1/2 flex-col break-words text-right">
                  <span>{new Date(proposal.proposedOn).toLocaleString()}</span>
                  <span>({Math.floor(new Date(proposal.proposedOn).getTime() / 1000)})</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="pb-10">
          <CardHeader>
            <CardTitle>Proposal Status</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-5">
              <VotingStatusIndicator
                label="Approvals"
                signatures={signatures.length}
                necessarySignatures={necessarySignatures}
              />
            </div>
          </CardContent>
        </Card>
        <Card className="pb-10">
          <CardHeader>
            <CardTitle>
              {user.role === "securityCouncil" ? "Security Council Actions" : "No role actions"}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col space-y-3">
            {user.role === "securityCouncil" && (
              <SignButton
                proposalId={proposal.id}
                contractData={{
                  actionName: action,
                  address: securityCouncilAddress,
                  name: "Guardians",
                }}
                nonce={BigInt(proposal.externalId)}
                type={proposal.type}
                validUntil={BigInt(Math.floor(new Date(proposal.validUntil).getTime() / 1000))}
                softFreezeThreshold={BigInt(proposal.softFreezeThreshold ?? 0)}
                disabled={signDisabled}
              >
                Approve
              </SignButton>
            )}
          </CardContent>
        </Card>
        <Card className="pb-10">
          <CardHeader>
            <CardTitle>Execute Actions</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col space-y-3">
            <ContractWriteButton
              target={securityCouncilAddress}
              signatures={signatures}
              functionName={"approveUpgradeSecurityCouncil"}
              abiName="council"
              threshold={necessarySignatures}
              disabled={!executeFreezeEnabled}
            >
              Execute freeze
            </ContractWriteButton>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
