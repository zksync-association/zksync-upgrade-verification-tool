import { type InferInsertModel, type InferSelectModel, eq } from "drizzle-orm";
import type { Hex } from "viem";
import { db } from "..";
import { l2CancellationsTable } from "../schema";
import { createOrIgnoreRecord, getFirst, getFirstOrThrow } from "./utils/common";

export async function createOrIgnoreL2Cancellation(
  data: InferInsertModel<typeof l2CancellationsTable>,
  { tx }: { tx: typeof db } = { tx: db }
) {
  return createOrIgnoreRecord(l2CancellationsTable, data, { tx }).then(getFirst);
}

export async function getL2Cancellations({ tx }: { tx: typeof db } = { tx: db }) {
  return tx.select().from(l2CancellationsTable);
}

export async function getL2CancellationById(
  id: InferSelectModel<typeof l2CancellationsTable>["id"],
  { tx }: { tx: typeof db } = { tx: db }
) {
  return tx
    .select()
    .from(l2CancellationsTable)
    .where(eq(l2CancellationsTable.id, id))
    .then(getFirst);
}

export async function getL2CancellationByExternalId(
  externalId: Hex,
  { tx }: { tx: typeof db } = { tx: db }
) {
  return tx
    .select()
    .from(l2CancellationsTable)
    .where(eq(l2CancellationsTable.externalId, externalId))
    .then(getFirst);
}

export async function updateL2Cancellation(
  id: InferSelectModel<typeof l2CancellationsTable>["id"],
  data: Partial<InferInsertModel<typeof l2CancellationsTable>>
) {
  return db
    .update(l2CancellationsTable)
    .set(data)
    .where(eq(l2CancellationsTable.id, id))
    .returning()
    .then(getFirstOrThrow);
}
