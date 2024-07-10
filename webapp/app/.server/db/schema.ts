import { bytea } from "@/.server/db/custom-types";
import { json, pgTable, serial, text, unique } from "drizzle-orm/pg-core";

export const upgradesTable = pgTable("upgrades", {
  id: serial("id").primaryKey(),
  proposalId: bytea("proposal_id").notNull().unique(),
  calldata: bytea("calldata").notNull(),
  checkReport: json("check_report"),
  storageDiffReport: json("storage_diff_report"),
});

export const signaturesTable = pgTable(
  "signatures",
  {
    id: serial("id").primaryKey(),
    proposal: bytea("proposal_id")
      .references(() => upgradesTable.proposalId)
      .notNull(),
    signer: bytea("signer").notNull(),
    signature: bytea("signature").notNull(),
    action: text("action", {
      enum: ["ExtendLegalVetoPeriod", "ApproveUpgradeGuardians", "ApproveUpgradeSecurityCouncil"],
    }).notNull(),
  },
  (t) => ({
    uniqueSigner: unique().on(t.proposal, t.signer),
  })
);
