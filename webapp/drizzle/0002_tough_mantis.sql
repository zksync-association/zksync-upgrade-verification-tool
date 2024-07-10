CREATE TABLE IF NOT EXISTS "signatures" (
	"id" serial PRIMARY KEY NOT NULL,
	"proposal_id" "bytea" NOT NULL,
	"signer" "bytea" NOT NULL,
	"signature" "bytea" NOT NULL,
	"action" text NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "signatures" ADD CONSTRAINT "signatures_proposal_id_upgrades_proposal_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."upgrades"("proposal_id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
