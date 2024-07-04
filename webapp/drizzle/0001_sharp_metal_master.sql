ALTER TABLE "upgrades" ADD COLUMN "upgrade_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "upgrades" ADD COLUMN "started_txid" text;--> statement-breakpoint
ALTER TABLE "upgrades" ADD COLUMN "finished_txid" text;--> statement-breakpoint
ALTER TABLE "upgrades" DROP COLUMN IF EXISTS "name";--> statement-breakpoint
ALTER TABLE "upgrades" DROP COLUMN IF EXISTS "status";--> statement-breakpoint
ALTER TABLE "upgrades" ADD CONSTRAINT "upgrades_upgrade_id_unique" UNIQUE("upgrade_id");