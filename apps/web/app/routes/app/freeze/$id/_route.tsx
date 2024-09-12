import { getFreezeProposalById } from "@/.server/db/dto/freeze-proposals";
import { getSignaturesByFreezeProposalId } from "@/.server/db/dto/signatures";
import {
  councilAddress,
  councilHardFreezeThreshold,
  councilSetSoftFreezeThresholdThreshold,
  councilSoftFreezeThreshold,
  councilUnfreezeThreshold,
} from "@/.server/service/contracts";
import { SIGNATURE_FACTORIES } from "@/.server/service/signatures";
import HeaderWithBackButton from "@/components/proposal-header-with-back-button";
import TxLink from "@/components/tx-link";
import TxStatus from "@/components/tx-status";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import VotingStatusIndicator from "@/components/voting-status-indicator";
import { compareHexValues } from "@/utils/compare-hex-values";
import { dateToUnixTimestamp } from "@/utils/date";
import { notFound } from "@/utils/http";
import { env } from "@config/env.server";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, useLoaderData } from "@remix-run/react";
import { hexSchema } from "@repo/common/schemas";
import { CircleCheckBig } from "lucide-react";
import { type Hex, isAddressEqual } from "viem";
import { z } from "zod";
import ContractWriteButton from "./contract-write-button";
import { extractFromParams, parseFormData } from "@/utils/read-from-request";
import { formError } from "@/utils/action-errors";
import { SignFreezeButton } from "@/routes/app/freeze/$id/write-transaction/sign-freeze-button";
import { requireUserFromRequest } from "@/utils/auth-headers";
import useUser from "@/components/hooks/use-user";

export async function loader({ params: remixParams }: LoaderFunctionArgs) {
  const { id } = extractFromParams(remixParams, z.object({ id: z.coerce.number() }), notFound());

  const proposal = await getFreezeProposalById(id);
  if (!proposal) {
    throw notFound();
  }

  const signatures = (await getSignaturesByFreezeProposalId(proposal.id)).sort((a, b) =>
    compareHexValues(a.signer, b.signer)
  );

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
    securityCouncilAddress: await councilAddress(),
    ethNetwork: env.ETH_NETWORK,
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const user = requireUserFromRequest(request);
  const parsed = parseFormData(await request.formData(), {
    signature: hexSchema,
    proposalId: z.coerce.number(),
  });

  if (!parsed.success) {
    throw formError(parsed.errors);
  }

  const body = parsed.data;

  await SIGNATURE_FACTORIES.freeze(body.proposalId, user.address, body.signature);

  return json({ ok: true });
}

export default function Freeze() {
  const {
    proposal,
    currentSoftFreezeThreshold,
    signatures,
    necessarySignatures,
    securityCouncilAddress,
    ethNetwork,
  } = useLoaderData<typeof loader>();
  const user = useUser();

  let proposalType: string;
  let functionName: Parameters<typeof ContractWriteButton>[0]["functionName"];
  switch (proposal.type) {
    case "SOFT_FREEZE":
      proposalType = "Soft Freeze";
      functionName = "softFreeze";
      break;
    case "HARD_FREEZE":
      proposalType = "Hard Freeze";
      functionName = "hardFreeze";
      break;
    case "SET_SOFT_FREEZE_THRESHOLD":
      proposalType = "Set Soft Freeze Threshold";
      functionName = "setSoftFreezeThreshold";
      break;
    case "UNFREEZE":
      proposalType = "Unfreeze";
      functionName = "unfreeze";
      break;
  }

  const proposalValidUntil = new Date(proposal.validUntil);

  const signDisabled =
    user.role !== "securityCouncil" ||
    signatures.some((s) => isAddressEqual(s.signer, user.address as Hex));

  const executeFreezeEnabled =
    signatures.length >= necessarySignatures && !proposal.transactionHash;

  return (
    <div className="flex flex-1 flex-col">
      <HeaderWithBackButton>
        {proposalType} Proposal {proposal.externalId}
      </HeaderWithBackButton>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
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
                  <span>{proposalValidUntil.toLocaleString()}</span>
                  <span data-testid="valid-until-timestamp">
                    ({dateToUnixTimestamp(proposalValidUntil)})
                  </span>
                </div>
              </div>
              <div className="flex justify-between">
                <span>Proposed On:</span>
                <div className="flex w-1/2 flex-col break-words text-right">
                  <span>{new Date(proposal.proposedOn).toLocaleString()}</span>
                  <span data-testid="proposed-on-timestamp">
                    ({dateToUnixTimestamp(new Date(proposal.proposedOn))})
                  </span>
                </div>
              </div>
              {proposal.transactionHash && (
                <div className="flex justify-between">
                  <span>Transaction Hash:</span>
                  <div className="flex flex-1 flex-col items-end space-y-1">
                    <TxLink hash={proposal.transactionHash} network={ethNetwork} />
                    <TxStatus hash={proposal.transactionHash} />
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
        <Card className="flex flex-col pb-10">
          <CardHeader>
            <CardTitle>Proposal Status</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-1">
            {proposal.transactionHash ? (
              <div className="flex flex-1 flex-col items-center justify-center space-y-2">
                <CircleCheckBig className="h-16 w-16 stroke-green-500" />
                <p>Executed</p>
              </div>
            ) : (
              <VotingStatusIndicator
                className="flex-1"
                label="Approvals"
                signatures={signatures.length}
                necessarySignatures={necessarySignatures}
                testId={"signature-count"}
              />
            )}
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
              <SignFreezeButton
                softFreezeThreshold={proposal.softFreezeThreshold}
                validUntil={proposalValidUntil}
                contractAddress={securityCouncilAddress}
                nonce={proposal.externalId}
                freezeType={proposal.type}
                proposalId={proposal.id}
                disabled={signDisabled}
              />
            )}
          </CardContent>
        </Card>
        <Card className="pb-10">
          <CardHeader>
            <CardTitle>Execute Actions</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col space-y-3">
            <ContractWriteButton
              proposalId={proposal.id}
              target={securityCouncilAddress}
              functionName={functionName}
              signatures={signatures}
              threshold={necessarySignatures}
              disabled={!executeFreezeEnabled}
              validUntil={proposalValidUntil}
              softFreezeThreshold={proposal.softFreezeThreshold}
            >
              Execute freeze
            </ContractWriteButton>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
