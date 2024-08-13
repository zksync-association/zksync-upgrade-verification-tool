import { db } from "@/.server/db/index";
import type { InferInsertModel } from "drizzle-orm";
import { emergencyProposalCalls } from "@/.server/db/schema";

export function createCall(
  data: InferInsertModel<typeof emergencyProposalCalls>,
  { tx }: { tx?: typeof db } = {}
) {
  return (tx ?? db).insert(emergencyProposalCalls).values(data).returning();
}