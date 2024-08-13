CREATE TABLE IF NOT EXISTS "emergency_proposal_calls" (
	"id" serial PRIMARY KEY NOT NULL,
	"proposal_id" integer NOT NULL,
	"target" "bytea" NOT NULL,
	"value" bigint,
	"data" "bytea" NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "emergency_proposal_calls" ADD CONSTRAINT "emergency_proposal_calls_proposal_id_emergency_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."emergency_proposals"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

-- migrate-data
insert into emergency_proposal_calls ("target", "proposal_id", "value", "data")
    select "target_address", "id", "value", "calldata" from emergency_proposals;

--> statement-breakpoint
ALTER TABLE "emergency_proposals" DROP COLUMN IF EXISTS "target_address";--> statement-breakpoint
ALTER TABLE "emergency_proposals" DROP COLUMN IF EXISTS "calldata";--> statement-breakpoint
ALTER TABLE "emergency_proposals" DROP COLUMN IF EXISTS "value";