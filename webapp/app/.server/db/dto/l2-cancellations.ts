import { type InferInsertModel, eq } from "drizzle-orm";
import { db } from "..";
import { l2CancellationStatusEnum, l2CancellationsTable, l2CancellationCalls } from "../schema";
import { createOrIgnoreRecord, getFirst, getFirstOrThrow } from "./utils/common";
import { Hex } from "viem";

export async function createOrIgnoreL2Cancellation(
  data: InferInsertModel<typeof l2CancellationsTable>,
  { tx }: { tx: typeof db } = { tx: db }
) {
  return createOrIgnoreRecord(l2CancellationsTable, data, { tx }).then(getFirst);
}

export async function getActiveL2Cancellations({ tx }: { tx: typeof db } = { tx: db }) {
  return tx
    .select()
    .from(l2CancellationsTable)
    .where(eq(l2CancellationsTable.status, l2CancellationStatusEnum.enum.ACTIVE));
}

export async function getL2CancellationByExternalId(
  externalId: Hex,
  { tx }: { tx: typeof db } = { tx: db }
) {
  return getFirstOrThrow(await tx
    .select()
    .from(l2CancellationsTable)
    .where(eq(l2CancellationsTable.externalId, externalId)))
}
