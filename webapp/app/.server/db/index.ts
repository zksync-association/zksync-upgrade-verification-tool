import * as schema from "@/.server/db/schema";
import { proposalsTable } from "@/.server/db/schema";
import { env } from "@config/env.server";
import { defaultLogger } from "@config/log.server";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

const logger = defaultLogger.child({ module: "db" });

export const queryClient = postgres(env.DATABASE_URL);
export const db = drizzle(queryClient, {
  schema,
  logger: {
    logQuery(query, params) {
      logger.debug({ params }, query);
    },
  },
});

async function testDbConnection() {
  try {
    await db.select().from(proposalsTable).limit(1);

    console.log("Connected to the database successfully");
  } catch (error) {
    if (error instanceof Error) {
      console.error("An error occurred while connecting to the database:", error.name);
      console.error(error.message);
      console.error(error.cause);
    }
    throw new Error("Failed to connect to the database");
  }
}

 testDbConnection();
