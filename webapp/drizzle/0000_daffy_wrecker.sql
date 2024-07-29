CREATE TABLE IF NOT EXISTS "proposals" (
	"id" serial PRIMARY KEY NOT NULL,
	"external_id" "bytea" NOT NULL,
	"calldata" "bytea" NOT NULL,
	"check_report" json,
	"storage_diff_report" json,
	"proposed_on" timestamp with time zone NOT NULL,
	"executor" "bytea" NOT NULL,
	"transaction_hash" "bytea" NOT NULL,
	"proposal_type" text DEFAULT 'routine' NOT NULL,
	CONSTRAINT "proposals_external_id_unique" UNIQUE("external_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "signatures" (
	"id" serial PRIMARY KEY NOT NULL,
	"proposal_id" "bytea" NOT NULL,
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
CREATE INDEX IF NOT EXISTS "external_id_idx" ON "proposals" USING btree ("external_id");