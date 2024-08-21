import type { L2GovernorProposalsType, signaturesTable } from "@/.server/db/schema";
import { guardiansAddress } from "@/.server/service/contracts";
import { hexSchema } from "@/common/basic-schemas";
import ProposalHeaderWithBackButton from "@/components/proposal-header-with-back-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import VotingStatusIndicator from "@/components/voting-status-indicator";
import { displayAddress } from "@/utils/address";
import { requireUserFromHeader } from "@/utils/auth-headers";
import { displayBytes32 } from "@/utils/bytes32";
import { notFound } from "@/utils/http";
import { env } from "@config/env.server";
import { type LoaderFunctionArgs, json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import type { InferSelectModel } from "drizzle-orm";
import { CircleCheckBig } from "lucide-react";
import { getParams } from "remix-params-helper";
import { type Address, parseEther, toHex } from "viem";
import { z } from "zod";
import SignButton from "./sign-button";

export async function loader({ request, params: remixParams }: LoaderFunctionArgs) {
  const user = requireUserFromHeader(request);

  const params = getParams(remixParams, z.object({ id: hexSchema }));
  if (!params.success) {
    throw notFound();
  }

  const proposal = {
    id: 9,
    externalId: params.data.id,
    type: "ZK_GOV_OPS_GOVERNOR" as L2GovernorProposalsType,
    proposer: "0xea2139a4982859687CcbafbC400c3258D2B4FeC0" as Address,
    description: "Proposal to change the governor",
    calls: [
      {
        id: 1,
        target: "0xC85797aC1fdB88C879dC93040eBEb64F6b410974",
        value: toHex(parseEther("2")),
        data: "0x",
      },
      {
        id: 2,
        target: "0xB91d180d5c2f6269041f0eAFe581ed438Fc1c6c3",
        value: toHex(parseEther("0.01")),
        data: "0x211b09a0b91b5b97466e9b406a4575c736cb5baefd4e77cc1c834c502a2b4eabaf5ee69d13161bf87571c7bfb33d5c50f46bb6584e7132ad1a1a75927c4c2d69b116261fc70012d163b5d8df10a89645f1c00708a40a50620c66506b2b7ccc08",
      },
    ],
    vetoTransactionHash: null as Address | null,
    nonce: 2n,
  };

  const signatures: InferSelectModel<typeof signaturesTable>[] = [
    {
      id: 1,
      l2GovernorProposal: proposal.id,
      action: "L2GovernorVetoProposal",
      signature: "0x1234",
      signer: "0x1234",
      emergencyProposal: null,
      freezeProposal: null,
      proposal: null,
    },
  ];
  const necessarySignatures = 5;

  let l2GovernorAddress: Address;
  switch (proposal.type) {
    case "ZK_GOV_OPS_GOVERNOR":
      l2GovernorAddress = env.ZK_GOV_OPS_GOVERNOR_ADDRESS;
      break;
    case "ZK_TOKEN_GOVERNOR":
      l2GovernorAddress = env.ZK_TOKEN_GOVERNOR_ADDRESS;
      break;
  }

  return json({
    user,
    proposal,
    signatures,
    necessarySignatures,
    guardiansAddress: await guardiansAddress(),
    l2GovernorAddress,
  });
}

// export async function action({ request }: ActionFunctionArgs) {
//   const user = requireUserFromHeader(request);
//   const data = await getFormData(
//     request,
//     z.object({
//       signature: zodHex,
//       proposalId: z.number(),
//       action: signActionSchema,
//     })
//   );
//   if (!data.success) {
//     throw badRequest("Failed to parse signature data");
//   }

//   const proposal = await getFreezeProposalById(data.data.proposalId);
//   if (!proposal) {
//     throw badRequest("Proposal not found");
//   }

//   await validateAndSaveFreezeSignature({
//     action: data.data.action,
//     proposal,
//     signature: data.data.signature,
//     signer: user.address as Hex,
//   });
//   return json({ ok: true });
// }

export default function L2GovernorProposal() {
  const { user, proposal, signatures, necessarySignatures, guardiansAddress, l2GovernorAddress } =
    useLoaderData<typeof loader>();

  let proposalType: string;
  switch (proposal.type) {
    case "ZK_GOV_OPS_GOVERNOR":
      proposalType = "GovOps Governor Proposal";
      break;
    case "ZK_TOKEN_GOVERNOR":
      proposalType = "Token Governor Proposal";
      break;
  }

  const signDisabled = user.role !== "guardian";

  return (
    <div className="flex flex-1 flex-col">
      <ProposalHeaderWithBackButton>
        Proposal {displayBytes32(proposal.externalId)}
      </ProposalHeaderWithBackButton>

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
                <span>{displayAddress(proposal.proposer)}</span>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="pb-10">
          <CardHeader>
            <CardTitle>Veto Status</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-1">
            {proposal.vetoTransactionHash ? (
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
              <SignButton
                proposal={{
                  id: proposal.id,
                  externalId: proposal.externalId,
                  nonce: BigInt(proposal.nonce),
                }}
                contractData={{
                  actionName: "L2GovernorVetoProposal",
                  address: guardiansAddress,
                  name: "Guardians",
                }}
                l2GasLimit={BigInt(1000000)}
                l2GasPerPubdataByteLimit={BigInt(1000)}
                l2GovernorAddress={l2GovernorAddress}
                refundRecipient="0x"
                txMintValue={BigInt(0)}
                disabled={signDisabled}
              >
                Approve
              </SignButton>
            )}
          </CardContent>
        </Card>
        {/* <Card className="pb-10">
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
            >
              Execute freeze
            </ContractWriteButton>
          </CardContent>
        </Card> */}
      </div>
    </div>
  );
}
