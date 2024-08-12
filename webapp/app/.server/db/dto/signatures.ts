import { db } from "@/.server/db";
import { createOrIgnoreRecord } from "@/.server/db/dto/utils/common";
import {
  type freezeProposalsTable,
  type proposalsTable,
  signaturesTable,
} from "@/.server/db/schema";
import { type InferInsertModel, type InferSelectModel, eq } from "drizzle-orm";

export async function createOrIgnoreSignature(
  data: InferInsertModel<typeof signaturesTable>,
  { tx }: { tx?: typeof db } = {}
): Promise<void> {
  await createOrIgnoreRecord(signaturesTable, data, { tx });
}

export async function getSignaturesByExternalProposalId(
  id: InferSelectModel<typeof proposalsTable>["externalId"]
) {
  return db.select().from(signaturesTable).where(eq(signaturesTable.proposal, id));
}

export async function getSignaturesByFreezeProposalId(
  id: InferSelectModel<typeof freezeProposalsTable>["id"]
) {
  return db.select().from(signaturesTable).where(eq(signaturesTable.freezeProposal, id));
}

export async function getSignaturesByEmergencyProposalId(
  id: InferSelectModel<typeof proposalsTable>["externalId"],
  { tx }: { tx?: typeof db } = {}
) {
  return (tx ?? db).select().from(signaturesTable).where(eq(signaturesTable.emergencyProposal, id));
}
