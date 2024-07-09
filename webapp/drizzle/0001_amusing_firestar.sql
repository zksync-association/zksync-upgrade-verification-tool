ALTER TABLE "upgrades" ADD COLUMN "proposal_id" "bytea" NOT NULL;--> statement-breakpoint
ALTER TABLE "upgrades" ADD COLUMN "check_report" json;--> statement-breakpoint
ALTER TABLE "upgrades" ADD COLUMN "storage_diff_report" json;--> statement-breakpoint
ALTER TABLE "upgrades" DROP COLUMN IF EXISTS "name";--> statement-breakpoint
ALTER TABLE "upgrades" DROP COLUMN IF EXISTS "status";--> statement-breakpoint
ALTER TABLE "upgrades" ADD CONSTRAINT "upgrades_proposal_id_unique" UNIQUE("proposal_id");