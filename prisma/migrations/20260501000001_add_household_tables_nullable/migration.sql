-- Migration 1 of 2: Add household tables and nullable household_id columns.
--
-- IMPORTANT: Do NOT apply both migrations with a single `migrate deploy` call.
-- After applying this migration you MUST run the backfill script, then apply
-- migration 2 separately. The full sequence:
--
--   npx prisma db execute \
--     --file prisma/migrations/20260501000001_add_household_tables_nullable/migration.sql \
--     --schema prisma/schema.prisma
--   npx prisma migrate resolve --applied 20260501000001_add_household_tables_nullable
--   npx tsx prisma/backfill.ts
--   npx prisma migrate deploy
--
-- Migration 2 makes household_id NOT NULL and will fail if any rows still have NULL.

-- CreateEnum
CREATE TYPE "HouseholdRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER', 'VIEWER');

-- CreateTable: households
CREATE TABLE "households" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "households_pkey" PRIMARY KEY ("id")
);

-- CreateTable: memberships
CREATE TABLE "memberships" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "household_id" UUID NOT NULL,
    "role" "HouseholdRole" NOT NULL DEFAULT 'MEMBER',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable: login_attempts
CREATE TABLE "login_attempts" (
    "id" UUID NOT NULL,
    "email" TEXT,
    "ip" TEXT,
    "success" BOOLEAN NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "login_attempts_pkey" PRIMARY KEY ("id")
);

-- AddColumn: nullable household_id to categories (will be made NOT NULL in migration 2)
ALTER TABLE "categories" ADD COLUMN "household_id" UUID;

-- AddColumn: nullable household_id to expenses (will be made NOT NULL in migration 2)
ALTER TABLE "expenses" ADD COLUMN "household_id" UUID;

-- Drop old global unique on categories.name and replace with a per-household unique.
-- The index is created here (not in migration 2) so the backfill can use
-- ON CONFLICT (household_id, name) DO NOTHING to copy global categories idempotently.
-- NULL household_id values do not collide in Postgres unique indexes, so existing
-- global categories (household_id IS NULL) are unaffected until the backfill deletes them.
DROP INDEX "categories_name_key";
CREATE UNIQUE INDEX "categories_household_id_name_key" ON "categories"("household_id", "name");

-- Indexes on new tables
CREATE UNIQUE INDEX "memberships_user_id_household_id_key" ON "memberships"("user_id", "household_id");
CREATE INDEX "memberships_household_id_idx" ON "memberships"("household_id");
CREATE INDEX "memberships_user_id_idx" ON "memberships"("user_id");
CREATE INDEX "login_attempts_email_created_at_idx" ON "login_attempts"("email", "created_at");
CREATE INDEX "login_attempts_ip_created_at_idx" ON "login_attempts"("ip", "created_at");

-- Partial indexes on new columns (safe while nullable)
CREATE INDEX "categories_household_id_idx" ON "categories"("household_id");
CREATE INDEX "expenses_household_id_invoice_date_idx" ON "expenses"("household_id", "invoice_date");

-- Foreign keys for new tables
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_household_id_fkey"
    FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;
