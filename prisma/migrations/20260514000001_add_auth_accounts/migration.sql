-- Migration: Add OAuth support.
-- Adds auth_accounts table, makes password_hash nullable so OAuth-only users
-- can exist without a password, and adds optional user profile columns.

-- 1. AuthProvider enum
CREATE TYPE "AuthProvider" AS ENUM ('GOOGLE', 'MICROSOFT');

-- 2. Make password_hash nullable (OAuth-only users have no password)
ALTER TABLE "users" ALTER COLUMN "password_hash" DROP NOT NULL;

-- 3. Optional user profile columns
ALTER TABLE "users" ADD COLUMN "email_verified_at" TIMESTAMPTZ(6);
ALTER TABLE "users" ADD COLUMN "image_url" TEXT;

-- 4. OAuth provider accounts table
CREATE TABLE "auth_accounts" (
    "id" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "provider" "AuthProvider" NOT NULL,
    "provider_account_id" TEXT NOT NULL,
    "provider_email" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "auth_accounts_pkey" PRIMARY KEY ("id")
);

-- 5. Foreign key: auth_accounts → users (cascade delete)
ALTER TABLE "auth_accounts" ADD CONSTRAINT "auth_accounts_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 6. One account per (provider, provider_account_id)
CREATE UNIQUE INDEX "auth_accounts_provider_provider_account_id_key"
    ON "auth_accounts"("provider", "provider_account_id");

-- 7. One OAuth provider per user (prevents linking same provider twice)
CREATE UNIQUE INDEX "auth_accounts_user_id_provider_key"
    ON "auth_accounts"("user_id", "provider");

-- 8. Lookup by provider email (for reporting, not for linking)
CREATE INDEX "auth_accounts_provider_email_idx"
    ON "auth_accounts"("provider_email");
