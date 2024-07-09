import { bytea } from "@/.server/db/custom-types";
import { json, pgEnum, pgTable, serial } from "drizzle-orm/pg-core";

export const upgradesTableStatus = pgEnum("status", ["pending", "completed"]);

export const upgradesTable = pgTable("upgrades", {
  id: serial("id").primaryKey(),
  proposalId: bytea("proposal_id").notNull().unique(),
  calldata: bytea("calldata").notNull(),
  checkReport: json("check_report"),
  storageDiffReport: json("storage_diff_report"),
});
