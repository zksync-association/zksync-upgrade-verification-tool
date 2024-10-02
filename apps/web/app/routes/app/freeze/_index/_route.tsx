import { createFreezeProposal, getAllFreezeProposals } from "@/.server/db/dto/freeze-proposals";
import { isValidationError } from "@/.server/db/errors";
import type { freezeProposalsTable } from "@/.server/db/schema";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formError, generalError } from "@/utils/action-errors";
import type { ActionFunctionArgs } from "@remix-run/node";
import { Link, json, redirect, useLoaderData } from "@remix-run/react";
import type { InferSelectModel } from "drizzle-orm";
import { ArrowRight } from "lucide-react";
import { $path } from "remix-routes";
import type { Jsonify } from "type-fest";
import { z } from "zod";
import { parseFormData } from "@/utils/read-from-request";
import { FreezeProposalsTypeEnum } from "@/common/freeze-proposal-type";
import { securityCouncilAddress } from "@/.server/service/ethereum-l1/contracts/protocol-upgrade-handler";
import {
  securityCouncilHardFreezeNonce,
  securityCouncilSoftFreezeNonce,
  securityCouncilSoftFreezeThresholdSettingNonce,
  securityCouncilUnfreezeNonce,
} from "@/.server/service/ethereum-l1/contracts/security-council";
import { CreateFreezeProposalModal } from "./create-freeze-proposal-modal";
import { Meta } from "@/utils/meta";
import { formatDateTime } from "@/utils/date";

export const meta = Meta["/app/freeze"];

export async function loader() {
  const proposals = await getAllFreezeProposals();

  const securityCouncil = await securityCouncilAddress();
  const [softFreezeNonce, hardFreezeNonce, softFreezeThresholdSettingNonce, unfreezeNonce] =
    await Promise.all([
      securityCouncilSoftFreezeNonce(securityCouncil),
      securityCouncilHardFreezeNonce(securityCouncil),
      securityCouncilSoftFreezeThresholdSettingNonce(securityCouncil),
      securityCouncilUnfreezeNonce(securityCouncil),
    ]);

  const isActive = (proposal: (typeof proposals)[number]) => {
    // Filter proposals already executed or ignored
    if (new Date(proposal.validUntil) <= new Date()) {
      return false;
    }

    // Filter archived proposals
    if (proposal.archivedOn !== null) {
      return false;
    }

    // Filter proposals already executed or ignored
    switch (proposal.type) {
      case "SOFT_FREEZE":
        return proposal.externalId >= softFreezeNonce;
      case "HARD_FREEZE":
        return proposal.externalId >= hardFreezeNonce;
      case "SET_SOFT_FREEZE_THRESHOLD":
        return proposal.externalId >= softFreezeThresholdSettingNonce;
      case "UNFREEZE":
        return proposal.externalId >= unfreezeNonce;
    }
  };

  const isInactive = (proposal: (typeof proposals)[number]) => !isActive(proposal);

  return json({
    activeProposals: proposals.filter(isActive),
    inactiveProposals: proposals.filter(isInactive),
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const parsed = parseFormData(
    await request.formData(),
    {
      validUntil: z.coerce.date().min(new Date()),
      threshold: z.coerce.number().min(1).max(9).nullable(),
      type: FreezeProposalsTypeEnum,
    },
    [
      {
        key: "threshold",
        check: (data) => data.type === "SET_SOFT_FREEZE_THRESHOLD" && data.threshold === null,
        message: () => "cannot be empty",
      },
      {
        key: "threshold",
        check: (data) => data.type !== "SET_SOFT_FREEZE_THRESHOLD" && data.threshold !== null,
        message: (data) => `${data.type} do not use threshold, but threshold was sent.`,
      },
    ]
  );

  if (parsed.errors) {
    return json(formError(parsed.errors));
  }

  const securityCouncil = await securityCouncilAddress();

  const data = parsed.data;

  let nonce: bigint;
  switch (data.type) {
    case "SOFT_FREEZE":
      nonce = await securityCouncilSoftFreezeNonce(securityCouncil);
      break;
    case "HARD_FREEZE":
      nonce = await securityCouncilHardFreezeNonce(securityCouncil);
      break;
    case "SET_SOFT_FREEZE_THRESHOLD":
      nonce = await securityCouncilSoftFreezeThresholdSettingNonce(securityCouncil);
      break;
    case "UNFREEZE":
      nonce = await securityCouncilUnfreezeNonce(securityCouncil);
      break;
  }

  let proposal: InferSelectModel<typeof freezeProposalsTable>;
  try {
    proposal = await createFreezeProposal({
      proposedOn: new Date(),
      type: data.type,
      softFreezeThreshold: data.threshold,
      validUntil: data.validUntil,
      externalId: nonce,
    });
  } catch (err) {
    if (isValidationError(err)) {
      return json(generalError("Pending proposal already exists."), 400);
    }
    throw err;
  }

  return redirect($path("/app/freeze/:id", { id: proposal.id }));
}

export default function Index() {
  const { activeProposals, inactiveProposals } = useLoaderData<typeof loader>();
  return (
    <div className="space-y-4">
      <ProposalCard
        title="Active Freeze Requests"
        proposals={activeProposals}
        type="active"
        data-testid="active-proposals-card"
      />
      <ProposalCard
        title="Inactive Freeze Requests"
        proposals={inactiveProposals}
        type="inactive"
        data-testid="inactive-proposals-card"
      />
    </div>
  );
}

function ProposalCard({
  title,
  proposals,
  className,
  type,
  ...props
}: {
  title: string;
  proposals: Jsonify<InferSelectModel<typeof freezeProposalsTable>>[];
  className?: string;
  type: "active" | "inactive";
  "data-testid": string;
}) {
  return (
    <Card className={className} data-testid={props["data-testid"]}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>{title}</CardTitle>
          {type === "active" && <CreateFreezeProposalModal />}
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col space-y-4">
          {proposals.map((proposal) => {
            const label = {
              SOFT_FREEZE: "Soft Freeze",
              HARD_FREEZE: "Hard Freeze",
              SET_SOFT_FREEZE_THRESHOLD: "Set Soft Freeze Threshold",
              UNFREEZE: "Unfreeze",
            }[proposal.type];

            return (
              <Link
                key={proposal.id}
                className="flex"
                to={$path("/app/freeze/:id", { id: proposal.id })}
              >
                <Button className="flex flex-1 justify-between pr-4" variant="outline">
                  <div className="flex items-center">
                    <span className="mr-4">
                      {label} - Proposal {proposal.externalId}
                    </span>
                    {proposal.archivedOn && (
                      <Badge className="mr-2" variant="destructive">
                        Archived
                      </Badge>
                    )}
                    <Badge className="" variant="secondary">
                      Valid until: {formatDateTime(proposal.validUntil)}
                    </Badge>
                  </div>
                  <ArrowRight />
                </Button>
              </Link>
            );
          })}
        </div>
        {proposals.length === 0 && (
          <div className="text-center text-gray-500">No {type} freeze requests found.</div>
        )}
      </CardContent>
    </Card>
  );
}
