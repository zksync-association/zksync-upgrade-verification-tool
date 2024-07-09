import { bytea } from "@/.server/db/custom-types";
import { pgEnum, pgTable, serial, text, json } from "drizzle-orm/pg-core";

export const upgradesTableStatus = pgEnum("status", ["pending", "completed"]);

export const upgradesTable = pgTable("upgrades", {
  id: serial("id").primaryKey(),
  proposalId: bytea("proposal_id").notNull().unique(),
  calldata: bytea("calldata").notNull(),
  checkReport: json("check_report"),
  storageDiffReport: json("storage_diff_report")
});
