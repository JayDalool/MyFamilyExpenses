-- Migration: Add pending signups for verified public email/password registration.
-- Stores unverified password signups until the user proves email ownership.

CREATE TABLE "pending_signups" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "verification_token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "pending_signups_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "pending_signups_email_key"
    ON "pending_signups"("email");

CREATE UNIQUE INDEX "pending_signups_verification_token_hash_key"
    ON "pending_signups"("verification_token_hash");

CREATE INDEX "pending_signups_expires_at_idx"
    ON "pending_signups"("expires_at");
