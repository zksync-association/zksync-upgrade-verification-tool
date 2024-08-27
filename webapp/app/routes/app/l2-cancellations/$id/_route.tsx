import { getl2CancellationCallsByProposalId } from "@/.server/db/dto/l2-cancellation-calls";
import { getL2CancellationById } from "@/.server/db/dto/l2-cancellations";
import { getSignaturesByL2CancellationId } from "@/.server/db/dto/signatures";
import { guardiansAddress } from "@/.server/service/contracts";
import {
  getAndUpdateL2CancellationByExternalId,
  getL2GovernorAddress,
  getL2VetoNonce,
} from "@/.server/service/l2-cancellations";
import { validateAndSaveL2CancellationSignature } from "@/.server/service/signatures";
import { hexSchema } from "@/common/basic-schemas";
import HeaderWithBackButton from "@/components/proposal-header-with-back-button";
import TxLink from "@/components/tx-link";
import TxStatus from "@/components/tx-status";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CallsRawData } from "@/components/upgrade-raw-data";
import VotingStatusIndicator from "@/components/voting-status-indicator";
import ExecL2VetoForm from "@/routes/app/l2-cancellations/$id/exec-l2-veto-form";
import { requireUserFromHeader } from "@/utils/auth-headers";
import { displayBytes32 } from "@/utils/bytes32";
import { badRequest, notFound } from "@/utils/http";
import { env } from "@config/env.server";
import { type ActionFunctionArgs, type LoaderFunctionArgs, json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { CircleCheckBig } from "lucide-react";
import { getFormData, getParams } from "remix-params-helper";
import { hexToBigInt, isAddressEqual } from "viem";
import { z } from "zod";
import SignButton from "./sign-button";

export async function loader({ request, params: remixParams }: LoaderFunctionArgs) {
  const user = requireUserFromHeader(request);

  const params = getParams(remixParams, z.object({ id: hexSchema }));
  if (!params.success) {
    throw notFound();
  }

  const proposal = await getAndUpdateL2CancellationByExternalId(params.data.id);

  const [calls, signatures, guardiansAddr, l2GovernorAddr] = await Promise.all([
    getl2CancellationCallsByProposalId(proposal.id),
    getSignaturesByL2CancellationId(proposal.id),
    guardiansAddress(),
    getL2GovernorAddress(proposal.type),
  ]);
  const necessarySignatures = 5; //FIXME: centralize this information or pull from contract

  return json({
    user,
    proposal,
    signatures,
    calls,
    necessarySignatures,
    guardiansAddress: guardiansAddr,
    l2GovernorAddress: l2GovernorAddr,
    ethNetwork: env.ETH_NETWORK,
    currentNonce: await getL2VetoNonce(),
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
    proposal,
    signature: data.data.signature,
    signer: user.address,
  });
  return json({ ok: true });
}

export default function L2Cancellation() {
  const {
    user,
    proposal,
    calls,
    signatures,
    necessarySignatures,
    guardiansAddress,
    ethNetwork,
    currentNonce,
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

  const isExactNonce = proposal.nonce === currentNonce;

  const signDisabled =
    user.role !== "guardian" || signatures.some((s) => isAddressEqual(s.signer, user.address));

  const execDisabled =
    signatures.length < necessarySignatures || proposal.transactionHash !== null || !isExactNonce;

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
              <div className="flex justify-between">
                <span>Nonce:</span>
                <span className="w-1/2 break-words text-right">{proposal.nonce}</span>
              </div>
              <div className="flex justify-between">
                <span>Veto L2 Gas Limit:</span>
                <span className="w-1/2 break-words text-right">
                  {hexToBigInt(proposal.txRequestGasLimit).toString()}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Veto L2 gas per pubdata byte limit:</span>
                <span className="w-1/2 break-words text-right">
                  {hexToBigInt(proposal.txRequestL2GasPerPubdataByteLimit).toString()}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Veto Refund Recipient:</span>
                <span className="w-1/2 break-words text-right">
                  {proposal.txRequestRefundRecipient}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Veto Transaction Mint Value:</span>
                <span className="w-1/2 break-words text-right">
                  {hexToBigInt(proposal.txRequestTxMintValue).toString()}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Veto Transaction To:</span>
                <span className="w-1/2 break-words text-right">{proposal.txRequestTo}</span>
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
            <ExecL2VetoForm
              proposalId={proposal.id}
              guardiansAddress={guardiansAddress}
              signatures={signatures}
              threshold={necessarySignatures}
              proposal={proposal}
              disabled={execDisabled}
              calls={calls}
            >
              Execute Veto
            </ExecL2VetoForm>

            {!isExactNonce && (
              <p className="text-red-500 text-s">
                Nonce does not match with contract. Maybe some other veto has to be executed before.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Tabs className="mt-4 flex" defaultValue="raw-data">
        <TabsList className="mt-12 mr-6">
          <TabsTrigger value="raw-data">L2 Calls</TabsTrigger>
        </TabsList>
        <TabsContent value="raw-data" className="w-full">
          <Card className="pb-8">
            <CardHeader>
              <CardTitle>L2 Calls</CardTitle>
            </CardHeader>
            <CardContent className="pt-4">
              <CallsRawData calls={calls} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
