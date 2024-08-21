import { db } from "@/.server/db";
import { l2CancellationCalls } from "@/.server/db/schema";
import { eq, InferInsertModel } from "drizzle-orm";

export function createL2CancellationCall(
  data: InferInsertModel<typeof l2CancellationCalls>,
  { tx }: { tx?: typeof db } = {}
) {
  return (tx ?? db).insert(l2CancellationCalls).values(data).returning();
}

export async function getl2CancellationCallsByProposalId(
  proposalId: number,
  { tx }: { tx?: typeof db } = {}
) {
  return (tx ?? db)
    .select()
    .from(l2CancellationCalls)
    .where(eq(l2CancellationCalls.proposalId, proposalId));
}
