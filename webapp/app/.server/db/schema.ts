import { bytea } from "@/.server/db/custom-types";
import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  json,
  pgTable,
  serial,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { z } from "zod";

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
  },
  (table) => ({
    externalIdIdx: index("external_id_idx").on(table.externalId),
  })
);

export const emergencyProposalsTable = pgTable(
  "emergency_proposals",
  {
    id: serial("id").primaryKey(),
    proposedOn: timestamp("proposed_on", { withTimezone: true }).notNull(),
    externalId: bytea("external_id").notNull().unique(),
    title: text("title").notNull(),
    targetAddress: bytea("target_address").notNull(),
    calls: bytea("calls").notNull(),
    value: bigint("value", { mode: "bigint" }).notNull(),
    proposer: bytea("proposer").notNull(),
    storageDiffReport: json("storage_diff_report"),
    checkReport: json("check_report"),
  },
  (table) => ({
    externalIdIdx: index("emergency_external_id_idx").on(table.externalId),
  })
);

export const actionSchema = z.enum([
  "ExtendLegalVetoPeriod",
  "ApproveUpgradeGuardians",
  "ApproveUpgradeSecurityCouncil",
  "ExecuteEmergencyUpgradeGuardians",
  "ExecuteEmergencyUpgradeSecurityCouncil",
  "ExecuteEmergencyUpgradeZKFoundation",
]);

export type Action = z.infer<typeof actionSchema>;

export const signaturesTable = pgTable(
  "signatures",
  {
    id: serial("id").primaryKey(),
    proposal: bytea("proposal_id").references(() => proposalsTable.externalId),
    emergencyProposal: bytea("emergency_proposal_id").references(
      () => emergencyProposalsTable.externalId
    ),
    signer: bytea("signer").notNull(),
    signature: bytea("signature").notNull(),
    action: text("action", {
      enum: actionSchema.options,
    }).notNull(),
  },
  ({ proposal, signer, action }) => ({
    uniqueSigner: unique().on(proposal, signer, action),
    proposalCheck: check(
      "mutual_exclusivity",
      sql`((proposal_id IS NOT NULL AND emergency_proposal_id IS NULL) OR 
           (proposal_id IS NULL AND emergency_proposal_id IS NOT NULL))`
    ),
  })
);
