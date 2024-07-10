ALTER TABLE "proposals" ADD COLUMN "proposed_on" timestamp with time zone NOT NULL;--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "executor" "bytea" NOT NULL;