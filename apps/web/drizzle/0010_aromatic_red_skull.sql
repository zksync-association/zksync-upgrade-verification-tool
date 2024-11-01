ALTER TABLE "emergency_proposals" ADD COLUMN "archived_on" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "emergency_proposals" ADD COLUMN "archived_reason" text;--> statement-breakpoint
ALTER TABLE "emergency_proposals" ADD COLUMN "archived_by" "bytea";--> statement-breakpoint
ALTER TABLE "emergency_proposals" ADD COLUMN "archived_signature" "bytea";--> statement-breakpoint
ALTER TABLE "freeze_proposals" ADD COLUMN "archived_on" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "freeze_proposals" ADD COLUMN "archived_reason" text;--> statement-breakpoint
ALTER TABLE "freeze_proposals" ADD COLUMN "archived_by" "bytea";--> statement-breakpoint
ALTER TABLE "freeze_proposals" ADD COLUMN "archived_signature" "bytea";--> statement-breakpoint
ALTER TABLE "l2_governor_cancellations" ADD COLUMN "archived_on" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "l2_governor_cancellations" ADD COLUMN "archived_reason" text;--> statement-breakpoint
ALTER TABLE "l2_governor_cancellations" ADD COLUMN "archived_by" "bytea";--> statement-breakpoint
ALTER TABLE "l2_governor_cancellations" ADD COLUMN "archived_signature" "bytea";