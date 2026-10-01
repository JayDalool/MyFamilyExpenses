-- Phase 1 cleanup: audit log foundation and expense soft deletes.

ALTER TABLE "expenses" ADD COLUMN "deleted_at" TIMESTAMPTZ(6);
ALTER TABLE "expenses" ADD COLUMN "deleted_by_user_id" UUID;

ALTER TABLE "expenses" ADD CONSTRAINT "expenses_deleted_by_user_id_fkey"
    FOREIGN KEY ("deleted_by_user_id") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "expenses_household_id_deleted_at_invoice_date_idx"
    ON "expenses"("household_id", "deleted_at", "invoice_date");

CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "household_id" UUID,
    "action" TEXT NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "audit_logs_user_id_created_at_idx"
    ON "audit_logs"("user_id", "created_at");
CREATE INDEX "audit_logs_household_id_created_at_idx"
    ON "audit_logs"("household_id", "created_at");
CREATE INDEX "audit_logs_action_created_at_idx"
    ON "audit_logs"("action", "created_at");

ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_household_id_fkey"
    FOREIGN KEY ("household_id") REFERENCES "households"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
