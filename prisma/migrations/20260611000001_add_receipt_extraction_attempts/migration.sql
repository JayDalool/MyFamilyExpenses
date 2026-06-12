-- CreateTable
CREATE TABLE "receipt_extraction_attempts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "household_id" UUID NOT NULL,
    "file_sha256" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "strategy" TEXT NOT NULL,
    "providers_used" JSONB NOT NULL,
    "model_versions" JSONB NOT NULL,
    "parser_version" TEXT NOT NULL,
    "raw_text" TEXT,
    "blocks" JSONB,
    "candidates" JSONB NOT NULL,
    "selected_extraction" JSONB NOT NULL,
    "warnings" JSONB NOT NULL,
    "receipt_type" TEXT NOT NULL,
    "merchant_guess" TEXT,
    "image_quality" JSONB NOT NULL,
    "confidence" JSONB NOT NULL,
    "duration_ms" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "consumed_at" TIMESTAMPTZ(6),
    "consumed_by_expense_id" UUID,

    CONSTRAINT "receipt_extraction_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "receipt_extraction_attempts_consumed_by_expense_id_key" ON "receipt_extraction_attempts"("consumed_by_expense_id");

-- CreateIndex
CREATE INDEX "receipt_extraction_attempts_household_id_created_at_idx" ON "receipt_extraction_attempts"("household_id", "created_at");

-- CreateIndex
CREATE INDEX "receipt_extraction_attempts_expires_at_idx" ON "receipt_extraction_attempts"("expires_at");

-- AddForeignKey
ALTER TABLE "receipt_extraction_attempts" ADD CONSTRAINT "receipt_extraction_attempts_user_id_household_id_fkey" FOREIGN KEY ("user_id", "household_id") REFERENCES "memberships"("user_id", "household_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipt_extraction_attempts" ADD CONSTRAINT "receipt_extraction_attempts_consumed_by_expense_id_fkey" FOREIGN KEY ("consumed_by_expense_id") REFERENCES "expenses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

