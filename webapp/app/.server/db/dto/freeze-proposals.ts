import { db } from "@/.server/db";
import { getFirst, getFirstOrThrow } from "@/.server/db/dto/utils/common";
import { freezeProposalsTable } from "@/.server/db/schema";
import { type InferInsertModel, type InferSelectModel, eq } from "drizzle-orm";

export async function createFreezeProposal(data: InferInsertModel<typeof freezeProposalsTable>) {
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
