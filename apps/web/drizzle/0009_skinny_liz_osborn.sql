-- Add the status column allowing NULL values initially
ALTER TABLE "proposals" ADD COLUMN "status" text;

-- Set all existing proposals to "ACTIVE" so the app can properly update them
UPDATE "proposals" SET "status" = 'ACTIVE';

-- Now make the status column NOT NULL
ALTER TABLE "proposals" ALTER COLUMN "status" SET NOT NULL;
