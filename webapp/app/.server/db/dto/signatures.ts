import type { db } from "@/.server/db";
import { createOrIgnoreRecord } from "@/.server/db/dto/utils/common";
import { signaturesTable } from "@/.server/db/schema";
import type { InferInsertModel } from "drizzle-orm";

export async function createOrIgnoreSignature(
  data: InferInsertModel<typeof signaturesTable>,
  { tx }: { tx?: typeof db } = {}
): Promise<void> {
  await createOrIgnoreRecord(signaturesTable, data, { tx });
}

// export async function getProposalByExternalId(externalId: string) {
//   return getFirst(
//     await db.select().from(proposalsTable).where(eq(proposalsTable.externalId, externalId))
//   );
// }
//
// export async function updateProposal(
//   data: Partial<InferInsertModel<typeof proposalsTable>> & {
//     id: InferSelectModel<typeof proposalsTable>["id"];
//   }
// ) {
//   return getFirstOrThrow(
//     await db.update(proposalsTable).set(data).where(eq(proposalsTable.id, data.id)).returning()
//   );
// }
