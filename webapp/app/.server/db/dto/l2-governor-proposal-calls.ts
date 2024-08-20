import { db } from "@/.server/db";
import { l2GovernorProposalCalls } from "@/.server/db/schema";
import { type InferInsertModel, eq } from "drizzle-orm";

export function createL2GovernorProposalCall(
  data: InferInsertModel<typeof l2GovernorProposalCalls>,
  { tx }: { tx?: typeof db } = {}
) {
  return (tx ?? db).insert(l2GovernorProposalCalls).values(data).returning();
}

export async function getl2GovernorProposalCallsByProposalId(
  proposalId: number,
  { tx }: { tx?: typeof db } = {}
) {
  return (tx ?? db)
    .select()
    .from(l2GovernorProposalCalls)
    .where(eq(l2GovernorProposalCalls.proposalId, proposalId));
}
