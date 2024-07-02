import * as schema from "@/.server/db/schema";
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
