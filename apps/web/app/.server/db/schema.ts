import { bytea } from "@/.server/db/custom-types";
import { emergencyProposalStatusSchema } from "@/common/proposal-status";
import { signActionEnum } from "@/common/sign-action";
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
      () => l2CancellationsTable.id
    ),
    signer: bytea("signer").notNull(),
    signature: bytea("signature").notNull(),
    action: text("action", {
      enum: signActionEnum.options,
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

export const FreezeProposalsTypeEnum = z.enum([
  "SOFT_FREEZE",
  "HARD_FREEZE",
  "UNFREEZE",
  "SET_SOFT_FREEZE_THRESHOLD",
]);

export type FreezeProposalsType = z.infer<typeof FreezeProposalsTypeEnum>;

export const freezeProposalsTable = pgTable(
  "freeze_proposals",
  {
    id: serial("id").primaryKey(),
    type: text("type", { enum: FreezeProposalsTypeEnum.options }).notNull(),
    externalId: bigint("external_id", { mode: "bigint" }).notNull(),
    validUntil: timestamp("valid_until", { withTimezone: true }).notNull(),
    proposedOn: timestamp("proposed_on", { withTimezone: true }).notNull(),
    softFreezeThreshold: bigint("soft_freeze_threshold", { mode: "number" }),
    transactionHash: bytea("transaction_hash"),
  },
  ({ externalId }) => ({
    externalIdIdx: index("freeze_proposals_external_id_idx").on(externalId),
    proposalCheck: check(
      "soft_freeze_threshold",
      sql`(
        (type = ${FreezeProposalsTypeEnum.Values.SET_SOFT_FREEZE_THRESHOLD} AND soft_freeze_threshold IS NOT NULL) OR
        (type != ${FreezeProposalsTypeEnum.Values.SET_SOFT_FREEZE_THRESHOLD} AND soft_freeze_threshold IS NULL)
      )`
    ),
  })
);

export const l2CancellationTypeEnum = z.enum(["ZK_GOV_OPS_GOVERNOR", "ZK_TOKEN_GOVERNOR"]);

export type L2CancellationType = z.infer<typeof l2CancellationTypeEnum>;

export const l2CancellationStatusEnum = z.enum([
  "ACTIVE",
  "DONE",
  "NONCE_TOO_LOW",
  "L2_PROPOSAL_EXPIRED",
]);

export const l2CancellationsTable = pgTable("l2_governor_cancellations", {
  id: serial("id").primaryKey(),
  externalId: bytea("external_id").notNull().unique(),
  type: text("type", { enum: l2CancellationTypeEnum.options }).notNull(),
  proposer: bytea("proposer").notNull(),
  description: text("description").notNull(),
  nonce: bigint("nonce", { mode: "number" }).notNull(),
  status: text("status", { enum: l2CancellationStatusEnum.options }).notNull(),
  txRequestGasLimit: bytea("tx_request_gas_limit").notNull(),
  txRequestL2GasPerPubdataByteLimit: bytea("tx_request_l2_gas_per_pubdata_byte_limit").notNull(),
  txRequestTo: bytea("tx_request_to").notNull(),
  txRequestRefundRecipient: bytea("tx_request_refund_recipient").notNull(),
  txRequestTxMintValue: bytea("tx_request_tx_mint_value").notNull(),
  transactionHash: bytea("transaction_hash"),
});

export const l2CancellationsTableRelations = relations(l2CancellationsTable, ({ many }) => {
  return {
    calls: many(l2CancellationCalls),
  };
});

export const l2CancellationCalls = pgTable("l2_cancellation_calls", {
  id: serial("id").primaryKey(),
  proposalId: integer("proposal_id")
    .notNull()
    .references(() => l2CancellationsTable.id),
  target: bytea("target").notNull(),
  value: bytea("value").notNull(),
  data: bytea("data").notNull(),
});

export const l2CancellationCallsRelations = relations(l2CancellationCalls, ({ one }) => {
  return {
    proposal: one(l2CancellationsTable, {
      fields: [l2CancellationCalls.proposalId],
      references: [l2CancellationsTable.id],
    }),
  };
});
