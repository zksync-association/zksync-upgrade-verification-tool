import { getl2CancellationCallsByProposalId } from "@/.server/db/dto/l2-cancellation-calls";
import {
  getL2CancellationByExternalId,
  getL2CancellationById,
} from "@/.server/db/dto/l2-cancellations";
import { getSignaturesByL2CancellationId } from "@/.server/db/dto/signatures";
import { councilAddress, guardiansAddress } from "@/.server/service/contracts";
import { getL2GovernorAddress } from "@/.server/service/l2-cancellations";
import { validateAndSaveL2CancellationSignature } from "@/.server/service/signatures";
import { hexSchema } from "@/common/basic-schemas";
import HeaderWithBackButton from "@/components/proposal-header-with-back-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import VotingStatusIndicator from "@/components/voting-status-indicator";
import { requireUserFromHeader } from "@/utils/auth-headers";
import { displayBytes32 } from "@/utils/bytes32";
import { badRequest, notFound } from "@/utils/http";
import { type ActionFunctionArgs, type LoaderFunctionArgs, json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { CircleCheckBig } from "lucide-react";
import { getFormData, getParams } from "remix-params-helper";
import { Hex, isAddressEqual, numberToHex, zeroAddress } from "viem";
import { z } from "zod";
import SignButton from "./sign-button";
import ExecL2VetoButton from "@/routes/app/l2-cancellations/$id/exec-l2-veto-button";

export async function loader({ request, params: remixParams }: LoaderFunctionArgs) {
  const user = requireUserFromHeader(request);

  const params = getParams(remixParams, z.object({ id: hexSchema }));
  if (!params.success) {
    throw notFound();
  }

  const proposal = await getL2CancellationByExternalId(params.data.id);
  const [calls, signatures, guardiansAddr, l2GovernorAddr] = await Promise.all([
    getl2CancellationCallsByProposalId(proposal.id),
    getSignaturesByL2CancellationId(proposal.id),
    guardiansAddress(),
    getL2GovernorAddress(proposal.type),
  ]);
  const necessarySignatures = 5; //FIXME

  return json({
    user,
    proposal: {
      ...proposal,
      txRequestGasLimit: numberToHex(1000000),
      txRequestL2GasPerPubdataByteLimit: numberToHex(BigInt(1000)),
      txRequestTo: l2GovernorAddr,
      txRequestRefundRecipient: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as Hex,
      txRequestTxMintValue: numberToHex(0)
    },
    signatures,
    calls,
    necessarySignatures,
    guardiansAddress: guardiansAddr,
    l2GovernorAddress: l2GovernorAddr,
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const user = requireUserFromHeader(request);
  const data = await getFormData(
    request,
    z.object({
      signature: hexSchema,
      proposalId: z.number(),
    })
  );
  if (!data.success) {
    throw badRequest("Failed to parse signature data");
  }

  const proposal = await getL2CancellationById(data.data.proposalId);
  if (!proposal) {
    throw badRequest("Proposal not found");
  }

  await validateAndSaveL2CancellationSignature({
    //FIXME: use the correct values
    l2GasLimit: BigInt(1000000),
    l2GasPerPubdataByteLimit: BigInt(1000),
    refundRecipient: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    txMintValue: BigInt(0),
    proposal,
    signature: data.data.signature,
    signer: user.address,
  });
  return json({ ok: true });
}

export default function L2GovernorProposal() {
  const {
    user,
    proposal,
    calls,
    signatures,
    necessarySignatures,
    guardiansAddress,
    l2GovernorAddress,
  } = useLoaderData<typeof loader>();

  let proposalType: string;
  switch (proposal.type) {
    case "ZK_GOV_OPS_GOVERNOR":
      proposalType = "GovOps Governor Proposal";
      break;
    case "ZK_TOKEN_GOVERNOR":
      proposalType = "Token Governor Proposal";
      break;
  }

  const signDisabled =
    user.role !== "guardian" || signatures.some((s) => isAddressEqual(s.signer, user.address));

  const execDisabled = signatures.length < necessarySignatures

  return (
    <div className="flex flex-1 flex-col">
      <HeaderWithBackButton>Proposal {displayBytes32(proposal.externalId)}</HeaderWithBackButton>

      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card className="pb-10">
          <CardHeader>
            <CardTitle>Proposal Details</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-6">
              <div className="flex justify-between">
                <span>Type:</span>
                <span>{proposalType}</span>
              </div>
              <div className="flex justify-between">
                <span>Description:</span>
                <span>{proposal.description}</span>
              </div>
              <div className="flex justify-between">
                <span>Proposer:</span>
                <span className="w-1/2 break-words text-right">{proposal.proposer}</span>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="pb-10">
          <CardHeader>
            <CardTitle>Veto Status</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-1">
            {proposal.status === "ACTIVE" && (
              <VotingStatusIndicator
                className="flex-1"
                label="Approvals"
                signatures={signatures.length}
                necessarySignatures={necessarySignatures}
              />
            )}
            {proposal.status === "DONE" && (
              <div className="flex flex-1 flex-col items-center justify-center space-y-2">
                <CircleCheckBig className="h-16 w-16 stroke-green-500" />
                <p>Executed</p>
              </div>
            )}
          </CardContent>
        </Card>
        <Card className="pb-10">
          <CardHeader>
            <CardTitle>
              {user.role === "guardian" ? "Guardian Actions" : "No role actions"}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col space-y-3">
            {user.role === "guardian" && (
              <SignButton
                proposal={{
                  id: proposal.id,
                  externalId: proposal.externalId,
                  nonce: proposal.nonce,
                }}
                contractData={{
                  actionName: "CancelL2GovernorProposal",
                  address: guardiansAddress,
                  name: "Guardians",
                }}
                //FIXME: use the correct values
                l2GasLimit={proposal.txRequestGasLimit}
                l2GasPerPubdataByteLimit={proposal.txRequestL2GasPerPubdataByteLimit}
                l2GovernorAddress={proposal.txRequestTo}
                refundRecipient={proposal.txRequestRefundRecipient}
                txMintValue={proposal.txRequestTxMintValue}
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
            <ExecL2VetoButton
              proposalId={proposal.id}
              guardiansAddress={guardiansAddress}
              signatures={signatures}
              threshold={necessarySignatures}
              proposal={proposal}
              disabled={execDisabled}
              calls={calls}
            >
              Execute freeze
            </ExecL2VetoButton>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
