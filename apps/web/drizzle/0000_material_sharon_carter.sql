CREATE TABLE IF NOT EXISTS "emergency_proposals" (
	"id" serial PRIMARY KEY NOT NULL,
	"proposed_on" timestamp with time zone NOT NULL,
	"external_id" "bytea" NOT NULL,
	"title" text NOT NULL,
	"target_address" "bytea" NOT NULL,
	"calldata" "bytea" NOT NULL,
	"salt" "bytea" NOT NULL,
	"value" bigint NOT NULL,
	"proposer" "bytea" NOT NULL,
	"storage_diff_report" json,
	"check_report" json,
	CONSTRAINT "emergency_proposals_external_id_unique" UNIQUE("external_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "proposals" (
	"id" serial PRIMARY KEY NOT NULL,
	"external_id" "bytea" NOT NULL,
	"calldata" "bytea" NOT NULL,
	"check_report" json,
	"storage_diff_report" json,
	"proposed_on" timestamp with time zone NOT NULL,
	"executor" "bytea" NOT NULL,
	"transaction_hash" "bytea" NOT NULL,
	CONSTRAINT "proposals_external_id_unique" UNIQUE("external_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "signatures" (
	"id" serial PRIMARY KEY NOT NULL,
	"proposal_id" "bytea",
	"emergency_proposal_id" "bytea",
	"signer" "bytea" NOT NULL,
	"signature" "bytea" NOT NULL,
	"action" text NOT NULL,
	CONSTRAINT "signatures_proposal_id_signer_action_unique" UNIQUE("proposal_id","signer","action")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "signatures" ADD CONSTRAINT "signatures_proposal_id_proposals_external_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("external_id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "signatures" ADD CONSTRAINT "signatures_emergency_proposal_id_emergency_proposals_external_id_fk" FOREIGN KEY ("emergency_proposal_id") REFERENCES "public"."emergency_proposals"("external_id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "emergency_external_id_idx" ON "emergency_proposals" USING btree ("external_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "external_id_idx" ON "proposals" USING btree ("external_id");