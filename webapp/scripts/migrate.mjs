import dotenv from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const envFile = process.env.NODE_ENV === "test" ? ".env.test" : ".env";
dotenv.config({ path: envFile });

if (!process.env.DATABASE_URL) {
  throw new Error("Database url env var not defined");
}
console.log(`Running on Environment: ${process.env.NODE_ENV}`);
console.log(`Migrating to ${process.env.DATABASE_URL}`);

const migrationClient = postgres(process.env.DATABASE_URL, { max: 1 });
const db = drizzle(migrationClient, { logger: true });

await migrate(db, { migrationsFolder: "./drizzle" });

await migrationClient.end();
