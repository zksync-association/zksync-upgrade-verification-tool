// import { NodeEnvEnum } from "@config/env.server";
import dotenv from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

async function main() {
  const env = process.argv[2];

  console.log(`Running on Environment: ${env}`);

  const envFile = `.env.${env}`;
  dotenv.config({ path: envFile });

  if (!process.env.DATABASE_URL) {
    throw new Error("Database url env var not defined");
  }

  const migrationClient = postgres(process.env.DATABASE_URL, { max: 1 });
  const db = drizzle(migrationClient, { logger: true });

  await migrate(db, { migrationsFolder: "./drizzle" });

  await migrationClient.end();
}

main();
