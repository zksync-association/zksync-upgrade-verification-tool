import { bytea } from "@/.server/db/custom-types";
import { index, json, pgTable, serial, text, timestamp, unique } from "drizzle-orm/pg-core";
import { z } from "zod";

export const proposalType = z.enum(["routine", "emergency"]);

export type ProposalType = z.infer<typeof proposalType>;

export const proposalsTable = pgTable(
  "proposals",
  {
    id: serial("id").primaryKey(),
    externalId: bytea("external_id").notNull().unique(),
    calldata: bytea("calldata").notNull(),
    checkReport: json("check_report"),
    storageDiffReport: json("storage_diff_report"),
    proposedOn: timestamp("proposed_on", { withTimezone: true }).notNull(),
    executor: bytea("executor").notNull(),
    transactionHash: bytea("transaction_hash").notNull(),
    proposalType: text("proposal_type", {
      enum: proposalType.options,
    })
      .default("routine")
      .notNull(),
  },
  (table) => ({
    externalIdIdx: index("external_id_idx").on(table.externalId),
  })
);

export const actionSchema = z.enum([
  "ExtendLegalVetoPeriod",
  "ApproveUpgradeGuardians",
  "ApproveUpgradeSecurityCouncil",
]);

export type Action = z.infer<typeof actionSchema>;

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
      enum: actionSchema.options,
    }).notNull(),
  },
  (t) => ({
    uniqueSigner: unique().on(t.proposal, t.signer, t.action),
  })
);
