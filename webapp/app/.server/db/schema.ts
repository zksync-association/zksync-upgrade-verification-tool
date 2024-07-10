import { bytea } from "@/.server/db/custom-types";
import { index, json, pgEnum, pgTable, serial, timestamp } from "drizzle-orm/pg-core";

export const proposalTableStatus = pgEnum("status", ["pending", "completed"]);

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
  },
  (table) => ({
    externalIdIdx: index("external_id_idx").on(table.externalId),
  })
);
