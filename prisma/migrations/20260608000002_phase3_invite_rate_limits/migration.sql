-- Keep invite abuse controls database-backed across app instances.
CREATE TABLE "invite_rate_limit_attempts" (
    "id" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "key_hash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invite_rate_limit_attempts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "invite_rate_limit_attempts_action_key_hash_created_at_idx"
ON "invite_rate_limit_attempts"("action", "key_hash", "created_at");

CREATE INDEX "invite_rate_limit_attempts_created_at_idx"
ON "invite_rate_limit_attempts"("created_at");
