import { db } from "@/.server/db";
import { emergencyProposalCalls } from "@/.server/db/schema";
import { type InferInsertModel, eq } from "drizzle-orm";

export function createEmergencyProposalCall(
  data: InferInsertModel<typeof emergencyProposalCalls>,
  { tx }: { tx?: typeof db } = {}
) {
  return (tx ?? db).insert(emergencyProposalCalls).values(data).returning();
}

export async function getEmergencyProposalCallsByProposalId(
  proposalId: number,
  { tx }: { tx?: typeof db } = {}
) {
  return (tx ?? db)
    .select()
    .from(emergencyProposalCalls)
    .where(eq(emergencyProposalCalls.proposalId, proposalId));
}
