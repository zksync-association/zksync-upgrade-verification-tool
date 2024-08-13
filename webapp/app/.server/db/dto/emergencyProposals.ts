import { db } from "@/.server/db";
import { createOrIgnoreRecord, getFirst, getFirstOrThrow } from "@/.server/db/dto/utils/common";
import { emergencyProposalsTable } from "@/.server/db/schema";
import { type InferInsertModel, type InferSelectModel, eq } from "drizzle-orm";
import type { Hex } from "viem";

export async function createOrIgnoreEmergencyProposal(
  data: InferInsertModel<typeof emergencyProposalsTable>,
  { tx }: { tx?: typeof db } = {}
): Promise<number> {
  const [record] = await createOrIgnoreRecord(emergencyProposalsTable, data, { tx });
  if (!record) {
    throw new Error("Error saving on db.");
  }
  return record.id;
}

export async function getAllEmergencyProposals() {
  return db.select().from(emergencyProposalsTable);
}

export async function getEmergencyProposalByExternalId(
  externalId: Hex,
  { tx }: { tx?: typeof db } = {}
) {
  return getFirst(
    await (tx ?? db)
      .select()
      .from(emergencyProposalsTable)
      .where(eq(emergencyProposalsTable.externalId, externalId))
  );
}

export async function updateEmergencyProposal(
  data: Partial<InferInsertModel<typeof emergencyProposalsTable>> & {
    id: InferSelectModel<typeof emergencyProposalsTable>["id"];
  }
) {
  return getFirstOrThrow(
    await db
      .update(emergencyProposalsTable)
      .set(data)
      .where(eq(emergencyProposalsTable.id, data.id))
      .returning()
  );
}
