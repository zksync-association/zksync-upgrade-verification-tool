import { bytea } from "@/.server/db/custom-types";
import { index, json, pgTable, serial, text, unique } from "drizzle-orm/pg-core";

export const proposalsTable = pgTable(
  "proposals",
  {
    id: serial("id").primaryKey(),
    externalId: bytea("external_id").notNull().unique(),
    calldata: bytea("calldata").notNull(),
    checkReport: json("check_report"),
    storageDiffReport: json("storage_diff_report"),
  },
  (table) => ({
    externalIdIdx: index("external_id_idx").on(table.externalId),
  })
);

export const signaturesTable = pgTable(
  "signatures",
  {
    id: serial("id").primaryKey(),
    proposal: bytea("proposal_id")
      .references(() => proposalsTable.externalId)
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
