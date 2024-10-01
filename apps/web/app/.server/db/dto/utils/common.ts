import { db } from "@/.server/db";
import type { InferInsertModel, SQL } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";

export function getFirstOrThrow<T>(value: T[]): T {
  const firstValue = getFirst(value);
  if (firstValue === undefined) {
    throw new Error("First element is undefined");
  }
  return firstValue;
}

export function getFirst<T>(value: T[]): T | undefined {
  return value[0];
}

export async function createOrIgnoreRecord<T extends PgTable>(
  table: T,
  data: InferInsertModel<typeof table>,
  { tx }: { tx?: typeof db } = {}
) {
  return (tx ?? db).insert(table).values(data).onConflictDoNothing().returning();
}

export type Filter<T extends PgTable> = (table: T["_"]["columns"]) => SQL;
