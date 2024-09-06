import type { freezeProposalsTable } from "@/.server/db/schema";
import { dateToUnixTimestamp } from "@/utils/date";
import type { InferSelectModel } from "drizzle-orm";



export function getFreezeProposalSignatureArgs(
  proposal: InferSelectModel<typeof freezeProposalsTable>
) {
  let message = {};
  const validUntil = dateToUnixTimestamp(proposal.validUntil);
  if (proposal.type === "SET_SOFT_FREEZE_THRESHOLD") {
    message = {
      threshold: proposal.softFreezeThreshold,
      nonce: proposal.externalId,
      validUntil,
    };
  } else {
    message = {
      nonce: proposal.externalId,
      validUntil,
    };
  }

  let types = [];
  if (proposal.type === "SET_SOFT_FREEZE_THRESHOLD") {
    types = [
      {
        name: "threshold",
        type: "uint256",
      },
      {
        name: "nonce",
        type: "uint256",
      },
      {
        name: "validUntil",
        type: "uint256",
      },
    ];
  } else {
    types = [
      {
        name: "nonce",
        type: "uint256",
      },
      {
        name: "validUntil",
        type: "uint256",
      },
    ];
  }

  return { message, types };
}
