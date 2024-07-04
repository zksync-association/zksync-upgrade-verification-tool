import { bytea } from "@/.server/db/custom-types";
import { pgEnum, pgTable, serial, text } from "drizzle-orm/pg-core";

export const upgradesTableStatus = pgEnum("status", ["pending", "completed"]);

export const upgradesTable = pgTable("upgrades", {
  id: serial("id").primaryKey(),
  upgradeId: text("upgrade_id").notNull().unique(),
  calldata: bytea("calldata").notNull(),
  startedTxid: text("started_txid"),
  finishedTxid: text("finished_txid")
});
