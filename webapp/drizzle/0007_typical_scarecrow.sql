CREATE TABLE IF NOT EXISTS "l2_cancellation_calls" (
	"id" serial PRIMARY KEY NOT NULL,
	"proposal_id" integer NOT NULL,
	"target" "bytea" NOT NULL,
	"value" "bytea" NOT NULL,
	"data" "bytea" NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "l2_governor_cancellations" (
	"id" serial PRIMARY KEY NOT NULL,
	"external_id" "bytea" NOT NULL,
	"type" text NOT NULL,
	"proposer" "bytea" NOT NULL,
	"description" text NOT NULL,
	"nonce" bigint NOT NULL,
	"status" text NOT NULL,
	"tx_request_gas_limit" "bytea" NOT NULL,
	"tx_request_l2_gas_per_pubdata_byte_limit" "bytea" NOT NULL,
	"tx_request_to" "bytea" NOT NULL,
	"tx_request_refund_recipient" "bytea" NOT NULL,
	"tx_request_tx_mint_value" "bytea" NOT NULL,
	"transaction_hash" "bytea",
	CONSTRAINT "l2_governor_cancellations_external_id_unique" UNIQUE("external_id")
);
--> statement-breakpoint
ALTER TABLE "signatures" ADD COLUMN "l2_governor_proposal_id" integer;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "l2_cancellation_calls" ADD CONSTRAINT "l2_cancellation_calls_proposal_id_l2_governor_cancellations_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."l2_governor_cancellations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "signatures" ADD CONSTRAINT "signatures_l2_governor_proposal_id_l2_governor_cancellations_id_fk" FOREIGN KEY ("l2_governor_proposal_id") REFERENCES "public"."l2_governor_cancellations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "signatures" ADD CONSTRAINT "signatures_l2_governor_proposal_id_signer_action_unique" UNIQUE("l2_governor_proposal_id","signer","action");