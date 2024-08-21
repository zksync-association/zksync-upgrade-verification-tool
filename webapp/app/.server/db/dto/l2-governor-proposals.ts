import { type InferInsertModel, eq } from "drizzle-orm";
import { db } from "..";
import { l2CancellationStatusEnum, l2CancellationsTable } from "../schema";
import { createOrIgnoreRecord, getFirst } from "./utils/common";

export async function createOrIgnoreL2GovernorProposal(
  data: InferInsertModel<typeof l2CancellationsTable>,
  { tx }: { tx: typeof db } = { tx: db }
) {
  return createOrIgnoreRecord(l2CancellationsTable, data, { tx }).then(getFirst);
}

export async function getActiveL2Governors({ tx }: { tx: typeof db } = { tx: db }) {
  return tx
    .select()
    .from(l2CancellationsTable)
    .where(eq(l2CancellationsTable.status, l2CancellationStatusEnum.enum.ACTIVE));
}
