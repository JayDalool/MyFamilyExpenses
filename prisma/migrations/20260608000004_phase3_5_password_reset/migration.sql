-- Phase 3.5: forgot/reset password tokens and dedicated rate-limit attempts.
-- The token table never stores raw secrets; only the SHA-256 hash of the
-- one-time URL token is persisted. Single-use is enforced by `used_at` plus an
-- atomic UPDATE in lib/auth/password-reset.ts; expiry is short-lived (30 min).

CREATE TABLE "password_reset_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "used_at" TIMESTAMPTZ(6),
    "requested_ip_hash" TEXT,
    "requested_user_agent_hash" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "password_reset_tokens_user_id_fkey"
        FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX "password_reset_tokens_token_hash_key"
    ON "password_reset_tokens"("token_hash");

CREATE INDEX "password_reset_tokens_user_id_idx"
    ON "password_reset_tokens"("user_id");

CREATE INDEX "password_reset_tokens_expires_at_idx"
    ON "password_reset_tokens"("expires_at");

CREATE TABLE "password_reset_rate_limit_attempts" (
    "id" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "key_hash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_rate_limit_attempts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "password_reset_rate_limit_attempts_action_key_hash_created_at_idx"
    ON "password_reset_rate_limit_attempts"("action", "key_hash", "created_at");

CREATE INDEX "password_reset_rate_limit_attempts_created_at_idx"
    ON "password_reset_rate_limit_attempts"("created_at");
