DO $$ BEGIN
 CREATE TYPE "public"."status" AS ENUM('pending', 'completed');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "proposals" (
	"id" serial PRIMARY KEY NOT NULL,
	"external_id" "bytea" NOT NULL,
	"calldata" "bytea" NOT NULL,
	"check_report" json,
	"storage_diff_report" json,
	CONSTRAINT "proposals_external_id_unique" UNIQUE("external_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "external_id_idx" ON "proposals" USING btree ("external_id");