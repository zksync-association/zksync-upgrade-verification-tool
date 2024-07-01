DO $$ BEGIN
 CREATE TYPE "public"."status" AS ENUM('pending', 'completed');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "upgrades" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"calldata" "bytea" NOT NULL,
	"status" "status" DEFAULT 'pending' NOT NULL
);
