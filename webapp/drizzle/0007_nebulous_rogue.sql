CREATE TABLE IF NOT EXISTS "l2_governor_proposal_calls" (
	"id" serial PRIMARY KEY NOT NULL,
	"proposal_id" integer NOT NULL,
	"target" "bytea" NOT NULL,
	"value" "bytea" NOT NULL,
	"data" "bytea" NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "l2_governor_proposals" (
	"id" serial PRIMARY KEY NOT NULL,
	"external_id" "bytea" NOT NULL,
	"type" text NOT NULL,
	"proposer" "bytea" NOT NULL,
	"description" text NOT NULL,
	CONSTRAINT "l2_governor_proposals_external_id_unique" UNIQUE("external_id")
);
--> statement-breakpoint
ALTER TABLE "signatures" ADD COLUMN "l2_governor_proposal_id" integer;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "l2_governor_proposal_calls" ADD CONSTRAINT "l2_governor_proposal_calls_proposal_id_l2_governor_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."l2_governor_proposals"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "signatures" ADD CONSTRAINT "signatures_l2_governor_proposal_id_l2_governor_proposals_id_fk" FOREIGN KEY ("l2_governor_proposal_id") REFERENCES "public"."l2_governor_proposals"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "signatures" ADD CONSTRAINT "signatures_l2_governor_proposal_id_signer_action_unique" UNIQUE("l2_governor_proposal_id","signer","action");