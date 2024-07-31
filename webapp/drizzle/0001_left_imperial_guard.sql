ALTER TABLE "emergency_proposals" ADD COLUMN "title" text NOT NULL;--> statement-breakpoint
ALTER TABLE "emergency_proposals" ADD COLUMN "target_address" "bytea" NOT NULL;