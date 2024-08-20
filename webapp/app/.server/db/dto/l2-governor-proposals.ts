import type { InferInsertModel } from "drizzle-orm";
import type { db } from "..";
import { l2GovernorProposalsTable } from "../schema";
import { createOrIgnoreRecord, getFirst } from "./utils/common";

export async function createOrIgnoreL2GovernorProposal(
  data: InferInsertModel<typeof l2GovernorProposalsTable>,
  { tx }: { tx?: typeof db } = {}
) {
  return createOrIgnoreRecord(l2GovernorProposalsTable, data, { tx }).then(getFirst);
}
