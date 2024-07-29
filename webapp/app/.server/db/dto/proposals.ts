import { db } from "@/.server/db";
import { createOrIgnoreRecord, getFirst, getFirstOrThrow } from "@/.server/db/dto/utils/common";
import { type ProposalType, proposalsTable } from "@/.server/db/schema";
import { type InferInsertModel, type InferSelectModel, and, eq } from "drizzle-orm";
import type { Hex } from "viem";

export async function createOrIgnoreProposal(
  data: InferInsertModel<typeof proposalsTable>,
  { tx }: { tx?: typeof db } = {}
) {
  await createOrIgnoreRecord(proposalsTable, data, { tx });
}

export async function getProposalByExternalId(externalId: Hex, type: ProposalType) {
  return getFirst(
    await db
      .select()
      .from(proposalsTable)
      .where(and(eq(proposalsTable.externalId, externalId), eq(proposalsTable.proposalType, type)))
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
