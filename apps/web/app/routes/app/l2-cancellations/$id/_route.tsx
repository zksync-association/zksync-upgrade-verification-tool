import { getl2CancellationCallsByProposalId } from "@/.server/db/dto/l2-cancellation-calls";
import { getL2CancellationById } from "@/.server/db/dto/l2-cancellations";
import { getSignaturesByL2CancellationId } from "@/.server/db/dto/signatures";
import {
  getAndUpdateL2CancellationByExternalId,
  getL2GovernorAddress,
  getL2VetoNonce,
} from "@/.server/service/l2-cancellations";
import { SIGNATURE_FACTORIES } from "@/.server/service/signatures";
import HeaderWithBackButton from "@/components/proposal-header-with-back-button";
import TxLink from "@/components/tx-link";
import TxStatus from "@/components/tx-status";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CallsRawData } from "@/components/upgrade-raw-data";
import VotingStatusIndicator from "@/components/voting-status-indicator";
import ExecL2VetoForm from "@/routes/app/l2-cancellations/$id/exec-l2-veto-form";
import { displayBytes32 } from "@/utils/common-tables";
import { badRequest, notFound } from "@/utils/http";
import { env } from "@config/env.server";
import { type ActionFunctionArgs, type LoaderFunctionArgs, json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { CircleCheckBig, CircleX } from "lucide-react";
import { hexSchema } from "@repo/common/schemas";
import { hexToBigInt, isAddressEqual } from "viem";
import { z } from "zod";
import { getFormDataOrThrow, extractFromParams } from "@/utils/read-from-request";
import { SignCancellationButton } from "@/routes/app/l2-cancellations/$id/sign-cancellation-button";
import { requireUserFromRequest } from "@/utils/auth-headers";
import useUser from "@/components/hooks/use-user";
import { guardiansAddress } from "@/.server/service/ethereum-l1/contracts/protocol-upgrade-handler";
import ZkAdminArchiveProposal from "@/components/zk-admin-archive-proposal";
import ProposalArchivedCard from "@/components/proposal-archived-card";

export async function loader({ params: remixParams }: LoaderFunctionArgs) {
  const { id } = extractFromParams(remixParams, z.object({ id: hexSchema }), notFound());

  const proposal = await getAndUpdateL2CancellationByExternalId(id);

  const [calls, signatures, guardiansAddr, l2GovernorAddr] = await Promise.all([
    getl2CancellationCallsByProposalId(proposal.id),
    getSignaturesByL2CancellationId(proposal.id),
    guardiansAddress(),
    getL2GovernorAddress(proposal.type),
  ]);
  const necessarySignatures = 5; //FIXME: centralize this information or pull from contract

  return json({
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
  const user = requireUserFromRequest(request);
  const data = await getFormDataOrThrow(request, {
    signature: hexSchema,
    proposalId: z.coerce.number(),
  });

  const proposal = await getL2CancellationById(data.proposalId);
  if (!proposal) {
    throw badRequest("Proposal not found");
  }

  await SIGNATURE_FACTORIES.l2Cancellation(data.proposalId, user.address, data.signature);

  return json({ ok: true });
}

export default function L2Cancellation() {
  const {
    proposal,
    calls,
    signatures,
    necessarySignatures,
    guardiansAddress,
    ethNetwork,
    currentNonce,
  } = useLoaderData<typeof loader>();
  const user = useUser();

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

  const proposalArchived = proposal.archivedOn !== null;

  const signDisabled =
    user.role !== "guardian" ||
    signatures.some((s) => isAddressEqual(s.signer, user.address)) ||
    proposalArchived;

  const execDisabled =
    signatures.length < necessarySignatures ||
    proposal.transactionHash !== null ||
    !isExactNonce ||
    proposalArchived;

  return (
    <div className="flex flex-1 flex-col">
      <HeaderWithBackButton>Proposal {displayBytes32(proposal.externalId)}</HeaderWithBackButton>

      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card className="pb-10" data-testid="proposal-details-card">
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
              {proposalArchived && (
                <ProposalArchivedCard
                  archivedBy={proposal.archivedBy ?? ""}
                  archivedOn={new Date(proposal.archivedOn ?? 0)}
                  archivedReason={proposal.archivedReason ?? ""}
                />
              )}
            </div>
          </CardContent>
        </Card>
        <Card className="pb-10">
          <CardHeader className="pt-7">
            <p className="text-red-500">{proposalArchived ? "Archived" : "\u00A0"}</p>
            <CardTitle>Veto Status</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-1">
            {proposal.status === "ACTIVE" && (
              <VotingStatusIndicator
                className="flex-1"
                label="Approvals"
                signatures={signatures.length}
                necessarySignatures={necessarySignatures}
                testId={"approvals-count"}
              />
            )}
            {proposal.status === "DONE" && (
              <div className="flex flex-1 flex-col items-center justify-center space-y-2">
                <CircleCheckBig className="h-16 w-16 stroke-green-500" />
                <p>Executed</p>
              </div>
            )}
            {proposal.status === "NONCE_TOO_LOW" && (
              <div className="flex flex-1 flex-col items-center justify-center space-y-2">
                <CircleX className="h-16 w-16 stroke-red-500" />
                <p>Nonce too low.</p>
              </div>
            )}
            {proposal.status === "L2_PROPOSAL_EXPIRED" && (
              <div className="flex flex-1 flex-col items-center justify-center space-y-2">
                <CircleX className="h-16 w-16 stroke-red-500" />
                <p>Proposal expired in l2</p>
              </div>
            )}
          </CardContent>
        </Card>
        <Card className="pb-10" data-testid="role-actions-card">
          <CardHeader>
            <CardTitle>
              {user.role === "guardian"
                ? "Guardian Actions"
                : user.role === "zkAdmin"
                  ? "Zk Admin Actions"
                  : "No role actions"}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col space-y-3">
            {user.role === "guardian" && (
              <SignCancellationButton
                contractAddress={guardiansAddress}
                proposalId={proposal.id}
                nonce={proposal.nonce}
                externalId={proposal.externalId}
                l2GasLimit={proposal.txRequestGasLimit}
                l2GasPerPubdataByteLimit={proposal.txRequestL2GasPerPubdataByteLimit}
                l2GovernorAddress={proposal.txRequestTo}
                refundRecipient={proposal.txRequestRefundRecipient}
                txMintValue={proposal.txRequestTxMintValue}
                disabled={signDisabled}
              />
            )}
            {user.role === "zkAdmin" && (
              <ZkAdminArchiveProposal
                proposalId={BigInt(proposal.id)}
                proposalType="ArchiveL2CancellationProposal"
                disabled={proposalArchived}
              />
            )}
          </CardContent>
        </Card>
        <Card className="pb-10" data-testid="execute-actions-card">
          <CardHeader>
            <CardTitle>Execute Actions</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col space-y-3">
            {proposal.status === "ACTIVE" && (
              <>
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
                    Nonce does not match with contract. Maybe some other veto has to be executed
                    before.
                  </p>
                )}
              </>
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
