import "dotenv/config";

import { env } from "@config/env.server";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const migrationClient = postgres(env.DATABASE_URL, { max: 1 });
const db = drizzle(migrationClient, { logger: true });

await migrate(db, { migrationsFolder: "./drizzle" });

await migrationClient.end();
