import { db } from "@/.server/db";
import { getFirst, getFirstOrThrow } from "@/.server/db/dto/utils/common";
import { proposalsTable } from "@/.server/db/schema";
import { type InferInsertModel, type InferSelectModel, eq } from "drizzle-orm";

export async function createOrIgnoreProposal(
  data: InferInsertModel<typeof proposalsTable>,
  { tx }: { tx?: typeof db } = {}
) {
  return getFirst(
    await (tx ?? db)
      .insert(proposalsTable)
      .values(data)
      .returning()
      .onConflictDoNothing({ target: proposalsTable.externalId })
  );
}

export async function getProposalByExternalId(externalId: string) {
  return getFirst(
    await db.select().from(proposalsTable).where(eq(proposalsTable.externalId, externalId))
  );
}

export async function updateProposal(
  data: Partial<InferInsertModel<typeof proposalsTable>> & {
    id: InferSelectModel<typeof proposalsTable>["id"];
  }
) {
  return getFirstOrThrow(
    await db.update(proposalsTable).set(data).where(eq(proposalsTable.id, data.id)).returning()
  );
}
