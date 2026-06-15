-- CreateTable
CREATE TABLE "receipt_correction_feedback" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "household_id" UUID NOT NULL,
    "expense_id" UUID NOT NULL,
    "attempt_id" UUID,
    "receipt_type" TEXT NOT NULL,
    "merchant_guess" TEXT,
    "parser_version" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "strategy" TEXT NOT NULL,
    "providers_used" JSONB NOT NULL,
    "category_id" UUID,
    "paid_by_user_id" UUID,
    "predicted_invoice_number" TEXT,
    "final_invoice_number" TEXT,
    "invoice_number_changed" BOOLEAN NOT NULL,
    "invoice_number_confidence" DOUBLE PRECISION,
    "predicted_invoice_date" TEXT,
    "final_invoice_date" TEXT,
    "invoice_date_changed" BOOLEAN NOT NULL,
    "invoice_date_confidence" DOUBLE PRECISION,
    "predicted_amount" DECIMAL(12,2),
    "final_amount" DECIMAL(12,2) NOT NULL,
    "amount_changed" BOOLEAN NOT NULL,
    "amount_confidence" DOUBLE PRECISION,
    "predicted_merchant" TEXT,
    "final_merchant" TEXT,
    "merchant_changed" BOOLEAN,
    "warnings" JSONB NOT NULL,
    "candidates_summary" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "receipt_correction_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "receipt_correction_feedback_expense_id_key" ON "receipt_correction_feedback"("expense_id");

-- CreateIndex
CREATE UNIQUE INDEX "receipt_correction_feedback_attempt_id_key" ON "receipt_correction_feedback"("attempt_id");

-- CreateIndex
CREATE INDEX "receipt_correction_feedback_household_id_created_at_idx" ON "receipt_correction_feedback"("household_id", "created_at");

-- CreateIndex
CREATE INDEX "receipt_correction_feedback_merchant_guess_idx" ON "receipt_correction_feedback"("merchant_guess");

-- AddForeignKey
ALTER TABLE "receipt_correction_feedback" ADD CONSTRAINT "receipt_correction_feedback_user_id_household_id_fkey" FOREIGN KEY ("user_id", "household_id") REFERENCES "memberships"("user_id", "household_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipt_correction_feedback" ADD CONSTRAINT "receipt_correction_feedback_attempt_id_fkey" FOREIGN KEY ("attempt_id") REFERENCES "receipt_extraction_attempts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipt_correction_feedback" ADD CONSTRAINT "receipt_correction_feedback_expense_id_fkey" FOREIGN KEY ("expense_id") REFERENCES "expenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
