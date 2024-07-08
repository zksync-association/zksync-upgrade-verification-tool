import { bytea } from "@/.server/db/custom-types";
import { pgEnum, pgTable, serial, text } from "drizzle-orm/pg-core";

export const upgradesTableStatus = pgEnum("status", ["pending", "completed"]);

export const upgradesTable = pgTable("upgrades", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  calldata: bytea("calldata").notNull(),
  status: upgradesTableStatus("status").notNull().default("pending"),
});
