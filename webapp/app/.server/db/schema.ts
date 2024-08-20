import { bytea } from "@/.server/db/custom-types";
import { emergencyProposalStatusSchema } from "@/common/proposal-status";
import { signActionSchema } from "@/common/sign-action";
import { relations, sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  integer,
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
    changedOn: timestamp("changed_on", { withTimezone: true }).notNull(),
    externalId: bytea("external_id").notNull().unique(),
    title: text("title").notNull(),
    salt: bytea("salt").notNull(),
    status: text("status", {
      enum: emergencyProposalStatusSchema.options,
    }).notNull(),
    proposer: bytea("proposer").notNull(),
    storageDiffReport: json("storage_diff_report"),
    checkReport: json("check_report"),
  },
  (table) => ({
    externalIdIdx: index("emergency_external_id_idx").on(table.externalId),
  })
);

export const emergencyProposalsTableRelations = relations(emergencyProposalsTable, ({ many }) => {
  return {
    calls: many(emergencyProposalCalls),
  };
});

export const emergencyProposalCalls = pgTable("emergency_proposal_calls", {
  id: serial("id").primaryKey(),
  proposalId: integer("proposal_id")
    .notNull()
    .references(() => emergencyProposalsTable.id),
  target: bytea("target").notNull(),
  value: bytea("value").notNull(),
  data: bytea("data").notNull(),
});

export const emergencyProposalCallsRelations = relations(emergencyProposalCalls, ({ one }) => {
  return {
    proposal: one(emergencyProposalsTable, {
      fields: [emergencyProposalCalls.proposalId],
      references: [emergencyProposalsTable.id],
    }),
  };
});

export const signaturesTable = pgTable(
  "signatures",
  {
    id: serial("id").primaryKey(),
    proposal: bytea("proposal_id").references(() => proposalsTable.externalId),
    emergencyProposal: bytea("emergency_proposal_id").references(
      () => emergencyProposalsTable.externalId
    ),
    freezeProposal: integer("freeze_proposal_id").references(() => freezeProposalsTable.id),
    l2GovernorProposal: integer("l2_governor_proposal_id").references(
      () => l2GovernorProposalsTable.id
    ),
    signer: bytea("signer").notNull(),
    signature: bytea("signature").notNull(),
    action: text("action", {
      enum: signActionSchema.options,
    }).notNull(),
  },
  ({ proposal, signer, action, emergencyProposal, freezeProposal, l2GovernorProposal }) => ({
    uniqueProposalSigner: unique().on(proposal, signer, action),
    uniqueEmergencyProposalSigner: unique().on(emergencyProposal, signer, action),
    uniqueFreezeProposalSigner: unique().on(freezeProposal, signer, action),
    uniqueL2GovernorProposalSigner: unique().on(l2GovernorProposal, signer, action),
    proposalCheck: check(
      "mutual_exclusivity",
      sql`(
            (proposal_id IS NOT NULL AND emergency_proposal_id IS NULL     AND freeze_proposal_id IS NULL     AND l2_governor_proposal_id IS NULL) OR
            (proposal_id IS NULL     AND emergency_proposal_id IS NOT NULL AND freeze_proposal_id IS NULL     AND l2_governor_proposal_id IS NULL) OR
            (proposal_id IS NULL     AND emergency_proposal_id IS NULL     AND freeze_proposal_id IS NOT NULL AND l2_governor_proposal_id IS NULL) OR
            (proposal_id IS NULL     AND emergency_proposal_id IS NULL     AND freeze_proposal_id IS NULL     AND l2_governor_proposal_id IS NOT NULL)
          )`
    ),
  })
);

export const freezeProposalsTypeSchema = z.enum([
  "SOFT_FREEZE",
  "HARD_FREEZE",
  "UNFREEZE",
  "SET_SOFT_FREEZE_THRESHOLD",
]);

export type FreezeProposalsType = z.infer<typeof freezeProposalsTypeSchema>;

export const freezeProposalsTable = pgTable(
  "freeze_proposals",
  {
    id: serial("id").primaryKey(),
    type: text("type", { enum: freezeProposalsTypeSchema.options }).notNull(),
    externalId: bigint("external_id", { mode: "bigint" }).notNull(),
    validUntil: timestamp("valid_until", { withTimezone: true }).notNull(),
    proposedOn: timestamp("proposed_on", { withTimezone: true }).notNull(),
    softFreezeThreshold: bigint("soft_freeze_threshold", { mode: "number" }),
    transactionHash: bytea("transaction_hash"),
  },
  ({ externalId, type }) => ({
    externalIdIdx: index("freeze_proposals_external_id_idx").on(externalId),
    uniqueProposal: unique().on(externalId, type),
    proposalCheck: check(
      "soft_freeze_threshold",
      sql`(
        (type = ${freezeProposalsTypeSchema.Values.SET_SOFT_FREEZE_THRESHOLD} AND soft_freeze_threshold IS NOT NULL) OR
        (type != ${freezeProposalsTypeSchema.Values.SET_SOFT_FREEZE_THRESHOLD} AND soft_freeze_threshold IS NULL)
      )`
    ),
  })
);

export const l2GovernorProposalsTypeSchema = z.enum(["ZK_GOV_OPS_GOVERNOR", "ZK_TOKEN_GOVERNOR"]);

export type L2GovernorProposalsType = z.infer<typeof l2GovernorProposalsTypeSchema>;

export const l2GovernorProposalsTable = pgTable("l2_governor_proposals", {
  id: serial("id").primaryKey(),
  externalId: bytea("external_id").notNull().unique(),
  type: text("type", { enum: l2GovernorProposalsTypeSchema.options }).notNull(),
  proposer: bytea("proposer").notNull(),
  description: text("description").notNull(),
});

export const l2GovernorProposalsTableRelations = relations(l2GovernorProposalsTable, ({ many }) => {
  return {
    calls: many(l2GovernorProposalCalls),
  };
});

export const l2GovernorProposalCalls = pgTable("l2_governor_proposal_calls", {
  id: serial("id").primaryKey(),
  proposalId: integer("proposal_id")
    .notNull()
    .references(() => l2GovernorProposalsTable.id),
  target: bytea("target").notNull(),
  value: bytea("value").notNull(),
  data: bytea("data").notNull(),
});
