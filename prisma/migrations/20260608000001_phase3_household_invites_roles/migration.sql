-- Preserve historical expense ownership while allowing household access removal.
ALTER TABLE "memberships"
ADD COLUMN "removed_at" TIMESTAMPTZ(6);

-- Carry a validated invite through email verification without storing the raw token.
ALTER TABLE "pending_signups"
ADD COLUMN "invite_token_hash" TEXT;

CREATE TABLE "household_invites" (
    "id" UUID NOT NULL,
    "household_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "email" TEXT,
    "role" "HouseholdRole" NOT NULL,
    "max_uses" INTEGER NOT NULL DEFAULT 1,
    "used_count" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "household_invites_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "household_invites_max_uses_check" CHECK ("max_uses" > 0),
    CONSTRAINT "household_invites_used_count_check" CHECK ("used_count" >= 0)
);

CREATE UNIQUE INDEX "household_invites_token_hash_key"
ON "household_invites"("token_hash");

CREATE INDEX "memberships_household_id_removed_at_idx"
ON "memberships"("household_id", "removed_at");

CREATE INDEX "household_invites_household_id_expires_at_idx"
ON "household_invites"("household_id", "expires_at");

CREATE INDEX "household_invites_household_id_revoked_at_idx"
ON "household_invites"("household_id", "revoked_at");

CREATE INDEX "household_invites_created_by_user_id_idx"
ON "household_invites"("created_by_user_id");

CREATE INDEX "household_invites_email_idx"
ON "household_invites"("email");

ALTER TABLE "household_invites"
ADD CONSTRAINT "household_invites_household_id_fkey"
FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "household_invites"
ADD CONSTRAINT "household_invites_created_by_user_id_fkey"
FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
