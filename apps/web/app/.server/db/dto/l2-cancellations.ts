import {
  type InferInsertModel,
  type InferSelectModel,
  and,
  eq,
  inArray,
  isNull,
  max,
} from "drizzle-orm";
import type { Hex } from "viem";
import { db } from "..";
import { l2CancellationStatusEnum, l2CancellationsTable } from "../schema";
import { getFirst, getFirstOrThrow } from "./utils/common";

export async function createL2Cancellation(
  data: InferInsertModel<typeof l2CancellationsTable>,
  { tx }: { tx: typeof db } = { tx: db }
) {
  return (tx ?? db).insert(l2CancellationsTable).values(data).returning().then(getFirstOrThrow);
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
  data: Partial<InferInsertModel<typeof l2CancellationsTable>> & {
    id: InferSelectModel<typeof l2CancellationsTable>["id"];
  }
) {
  return db
    .update(l2CancellationsTable)
    .set(data)
    .where(eq(l2CancellationsTable.id, data.id))
    .returning()
    .then(getFirstOrThrow);
}

export async function getMaxRegisteredNonce(): Promise<number | null> {
  const row = await db
    .select({ value: max(l2CancellationsTable.nonce) })
    .from(l2CancellationsTable)
    .where(
      and(
        isNull(l2CancellationsTable.archivedOn),
        inArray(l2CancellationsTable.status, [
          l2CancellationStatusEnum.enum.ACTIVE,
          l2CancellationStatusEnum.enum.DONE,
        ])
      )
    )
    .then(getFirst);
  return row && row.value !== null ? Number(row.value) : null;
}

export async function existActiveProposalWithNonce(nonce: number): Promise<boolean> {
  const [row] = await db
    .select({ id: l2CancellationsTable.id })
    .from(l2CancellationsTable)
    .where(
      and(
        eq(l2CancellationsTable.nonce, nonce),
        eq(l2CancellationsTable.status, l2CancellationStatusEnum.enum.ACTIVE),
        isNull(l2CancellationsTable.archivedOn)
      )
    );
  return row !== undefined;
}
