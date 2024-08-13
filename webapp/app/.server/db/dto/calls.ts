import { db } from "@/.server/db/index";
import { eq, type InferInsertModel } from "drizzle-orm";
import { emergencyProposalCalls } from "@/.server/db/schema";

export function createCall(
  data: InferInsertModel<typeof emergencyProposalCalls>,
  { tx }: { tx?: typeof db } = {}
) {
  const value = data.value === "0x" ? "0x00" : data.value
  return (tx ?? db).insert(emergencyProposalCalls).values({ ...data, value }).returning();
}

export async function getCallsByProposalId(proposalId: number, { tx }: { tx?: typeof db } = {}) {
  return (tx ?? db)
    .select()
    .from(emergencyProposalCalls)
    .where(eq(emergencyProposalCalls.proposalId, proposalId));
}
