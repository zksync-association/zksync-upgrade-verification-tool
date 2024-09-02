import { db } from "@/.server/db";
import { getFirst, getFirstOrThrow } from "@/.server/db/dto/utils/common";
import { ValidationError } from "@/.server/db/errors";
import { freezeProposalsTable } from "@/.server/db/schema";
import { type InferInsertModel, type InferSelectModel, and, eq } from "drizzle-orm";

export async function createFreezeProposal(data: InferInsertModel<typeof freezeProposalsTable>) {
  const existing = await db
    .select()
    .from(freezeProposalsTable)
    .where(
      and(
        eq(freezeProposalsTable.externalId, data.externalId),
        eq(freezeProposalsTable.type, data.type)
      )
    );

  const someIsNotExpired = existing.some((row) => row.validUntil.valueOf() > new Date().valueOf());

  if (someIsNotExpired) {
    throw new ValidationError(`There is already an active ${data.type} proposal.`);
  }

  return await db.insert(freezeProposalsTable).values(data).returning().then(getFirstOrThrow);
}

export async function getAllFreezeProposals() {
  return db.select().from(freezeProposalsTable);
}

export async function getFreezeProposalById(
  id: InferSelectModel<typeof freezeProposalsTable>["id"]
) {
  return db
    .select()
    .from(freezeProposalsTable)
    .where(eq(freezeProposalsTable.id, id))
    .then(getFirst);
}

export async function updateFreezeProposal(
  id: InferSelectModel<typeof freezeProposalsTable>["id"],
  data: Partial<InferInsertModel<typeof freezeProposalsTable>>
) {
  return db
    .update(freezeProposalsTable)
    .set(data)
    .where(eq(freezeProposalsTable.id, id))
    .returning()
    .then(getFirstOrThrow);
}
