import { getFreezeProposalById } from "@/.server/db/dto/freeze-proposals";
import { getSignaturesByFreezeProposalId } from "@/.server/db/dto/signatures";
import { SIGNATURE_FACTORIES } from "@/.server/service/signatures";
import HeaderWithBackButton from "@/components/proposal-header-with-back-button";
import TxLink from "@/components/tx-link";
import TxStatus from "@/components/tx-status";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import VotingStatusIndicator from "@/components/voting-status-indicator";
import { compareHexValues } from "@/utils/compare-hex-values";
import { formatDateTime } from "@/utils/date";
import { notFound } from "@/utils/http";
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
import {
  securityCouncilHardFreezeThreshold,
  securityCouncilSoftFreezeConservativeThreshold,
  securityCouncilSoftFreezeThreshold,
  securityCouncilUnfreezeThreshold,
} from "@/.server/service/ethereum-l1/contracts/security-council";
import { securityCouncilAddress } from "@/.server/service/ethereum-l1/contracts/protocol-upgrade-handler";
import { EthereumConfig } from "@config/ethereum.server";
import ProposalArchivedCard from "@/components/proposal-archived-card";
import ZkAdminArchiveProposal from "@/components/zk-admin-archive-proposal";
import type { ZkAdminSignAction } from "@/routes/resources+/zk-admin-sign";
import { Meta } from "@/utils/meta";
import ExecuteActionsCard from "@/components/proposal-components/execute-actions-card";
import SignActionsCard from "@/components/proposal-components/sign-actions-card";

export const meta = Meta["/app/freeze/:id"];

export async function loader({ params: remixParams }: LoaderFunctionArgs) {
  const { id } = extractFromParams(remixParams, z.object({ id: z.coerce.number() }), notFound());

  const proposal = await getFreezeProposalById(id);
  if (!proposal) {
    throw notFound();
  }

  const signatures = (await getSignaturesByFreezeProposalId(proposal.id)).sort((a, b) =>
    compareHexValues(a.signer, b.signer)
  );

  const securityCouncil = await securityCouncilAddress();

  let currentSoftFreezeThreshold: bigint | undefined;
  if (proposal.type === "SET_SOFT_FREEZE_THRESHOLD") {
    currentSoftFreezeThreshold = await securityCouncilSoftFreezeThreshold(securityCouncil);
  }

  let necessarySignatures: number;
  switch (proposal.type) {
    case "SOFT_FREEZE":
      necessarySignatures = Number(await securityCouncilSoftFreezeThreshold(securityCouncil));
      break;
    case "HARD_FREEZE":
      necessarySignatures = Number(await securityCouncilHardFreezeThreshold(securityCouncil));
      break;
    case "SET_SOFT_FREEZE_THRESHOLD":
      necessarySignatures = Number(
        await securityCouncilSoftFreezeConservativeThreshold(securityCouncil)
      );
      break;
    case "UNFREEZE":
      necessarySignatures = Number(await securityCouncilUnfreezeThreshold(securityCouncil));
      break;
  }

  return json({
    proposal,
    currentSoftFreezeThreshold,
    signatures,
    necessarySignatures,
    securityCouncilAddress: securityCouncil,
    transactionUrl: proposal.transactionHash
      ? EthereumConfig.getTransactionUrl(proposal.transactionHash)
      : "",
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
    transactionUrl,
  } = useLoaderData<typeof loader>();
  const user = useUser();

  let proposalType: string;
  let functionName: Parameters<typeof ContractWriteButton>[0]["functionName"];
  let zkAdminSignAction: ZkAdminSignAction;
  switch (proposal.type) {
    case "SOFT_FREEZE":
      proposalType = "Soft Freeze";
      functionName = "softFreeze";
      zkAdminSignAction = "ArchiveSoftFreezeProposal";
      break;
    case "HARD_FREEZE":
      proposalType = "Hard Freeze";
      functionName = "hardFreeze";
      zkAdminSignAction = "ArchiveHardFreezeProposal";
      break;
    case "SET_SOFT_FREEZE_THRESHOLD":
      proposalType = "Set Soft Freeze Threshold";
      functionName = "setSoftFreezeThreshold";
      zkAdminSignAction = "ArchiveSetSoftFreezeThresholdProposal";
      break;
    case "UNFREEZE":
      proposalType = "Unfreeze";
      functionName = "unfreeze";
      zkAdminSignAction = "ArchiveUnfreezeProposal";
      break;
  }

  const proposalValidUntil = new Date(proposal.validUntil);
  const proposalArchived = proposal.archivedOn !== null;

  const signDisabled =
    user.role !== "securityCouncil" ||
    signatures.some((s) => isAddressEqual(s.signer, user.address as Hex)) ||
    proposalArchived;

  const executeFreezeEnabled =
    signatures.length >= necessarySignatures && !proposal.transactionHash && !proposalArchived;

  return (
    <div className="flex flex-1 flex-col">
      <HeaderWithBackButton>
        {proposalType} - Proposal {proposal.externalId}
      </HeaderWithBackButton>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card data-testid="proposal-details-card">
          <CardHeader>
            <CardTitle>Freeze Details</CardTitle>
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
                <span data-testid="valid-until-timestamp">
                  {formatDateTime(proposalValidUntil)}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Proposed On:</span>
                <span data-testid="proposed-on-timestamp">
                  {formatDateTime(proposal.proposedOn)}
                </span>
              </div>
              {proposal.transactionHash && (
                <div className="flex justify-between">
                  <span>Transaction Hash:</span>
                  <div className="flex flex-1 flex-col items-end space-y-1">
                    <TxLink hash={proposal.transactionHash} url={transactionUrl} />
                    <TxStatus hash={proposal.transactionHash} />
                  </div>
                </div>
              )}
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
        <Card className="flex flex-col">
          <CardHeader className="pt-7">
            <p className="text-red-500">{proposalArchived ? "Archived" : "\u00A0"}</p>
            <CardTitle>Freeze Status</CardTitle>
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
                role="securityCouncil"
                signatures={signatures.length}
                necessarySignatures={necessarySignatures}
                signers={signatures.map((s) => s.signer)}
              />
            )}
          </CardContent>
        </Card>
        <SignActionsCard role={user.role} enabledRoles={["securityCouncil", "zkAdmin"]}>
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
          {user.role === "zkAdmin" && (
            <ZkAdminArchiveProposal
              proposalId={BigInt(proposal.id)}
              proposalType={zkAdminSignAction}
              disabled={proposalArchived}
            />
          )}
        </SignActionsCard>
        <ExecuteActionsCard>
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
        </ExecuteActionsCard>
      </div>
    </div>
  );
}
