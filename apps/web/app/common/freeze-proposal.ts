import type { freezeProposalsTable } from "@/.server/db/schema";
import type { InferSelectModel } from "drizzle-orm";
import { buildSignatureMessage, ethTypesForFreezeKind } from "@/common/freeze-proposal-type";

export function getFreezeProposalSignatureArgs(
  proposal: InferSelectModel<typeof freezeProposalsTable>
) {

  const message = buildSignatureMessage(proposal);
  const types = ethTypesForFreezeKind(proposal.type);

  return { message, types };
}
