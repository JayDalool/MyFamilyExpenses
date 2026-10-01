-- Additive only: existing rows stay valid. Existing households become FAMILY.
ALTER TYPE "HouseholdRole" ADD VALUE IF NOT EXISTS 'ACCOUNTANT';

CREATE TYPE "HouseholdKind" AS ENUM ('FAMILY', 'COMPANY');

ALTER TABLE "households" ADD COLUMN "kind" "HouseholdKind" NOT NULL DEFAULT 'FAMILY';
