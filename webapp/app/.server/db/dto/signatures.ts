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
