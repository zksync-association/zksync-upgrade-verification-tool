CREATE TABLE IF NOT EXISTS "freeze_proposals" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"external_id" bigint NOT NULL,
	"valid_until" timestamp with time zone NOT NULL,
	"proposed_on" timestamp with time zone NOT NULL,
	"soft_freeze_threshold" bigint,
	CONSTRAINT "freeze_proposals_external_id_type_unique" UNIQUE("external_id","type")
);
--> statement-breakpoint
ALTER TABLE "signatures" ADD COLUMN "freeze_proposal_id" integer;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "freeze_proposals_external_id_idx" ON "freeze_proposals" USING btree ("external_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "signatures" ADD CONSTRAINT "signatures_freeze_proposal_id_freeze_proposals_id_fk" FOREIGN KEY ("freeze_proposal_id") REFERENCES "public"."freeze_proposals"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "signatures" ADD CONSTRAINT "signatures_emergency_proposal_id_signer_action_unique" UNIQUE("emergency_proposal_id","signer","action");--> statement-breakpoint
ALTER TABLE "signatures" ADD CONSTRAINT "signatures_freeze_proposal_id_signer_action_unique" UNIQUE("freeze_proposal_id","signer","action");