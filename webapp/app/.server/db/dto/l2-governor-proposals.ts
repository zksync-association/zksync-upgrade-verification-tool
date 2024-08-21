import { eq, InferInsertModel, InferSelectModel } from "drizzle-orm";
import { db } from "..";
import { l2GovernorProposalsStatusEnum, l2GovernorProposalsTable } from "../schema";
import { createOrIgnoreRecord, getFirst } from "./utils/common";

export async function createOrIgnoreL2GovernorProposal(
  data: InferInsertModel<typeof l2GovernorProposalsTable>,
  { tx }: { tx: typeof db } = { tx: db }
) {
  return createOrIgnoreRecord(l2GovernorProposalsTable, data, { tx }).then(getFirst);
}

export async function getActiveL2Governors(
  { tx }: { tx: typeof db } = { tx: db }
) {
  return tx.select()
    .from(l2GovernorProposalsTable)
    .where(eq(l2GovernorProposalsTable.status, l2GovernorProposalsStatusEnum.enum.ACTIVE))
}
