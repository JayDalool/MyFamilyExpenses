-- Step 4 of docs/upgrade-plan.md. Additive only: no column is dropped or
-- rewritten, so existing rows stay valid and a rollback only needs the app to
-- read "amount" again. See docs/adr/0002-money-in-cents.md.

CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'DEBIT', 'CREDIT', 'ETRANSFER', 'OTHER');

-- Money moves to integer cents, tax included, matching SamVision's amount_cents.
-- Added nullable so the backfill can run before the NOT NULL constraint.
ALTER TABLE "expenses" ADD COLUMN "amount_cents" INTEGER;
ALTER TABLE "expenses" ADD COLUMN "tax_cents" INTEGER;
ALTER TABLE "expenses" ADD COLUMN "currency" CHAR(3) NOT NULL DEFAULT 'CAD';
ALTER TABLE "expenses" ADD COLUMN "vendor" TEXT;
ALTER TABLE "expenses" ADD COLUMN "payment_method" "PaymentMethod";
ALTER TABLE "expenses" ADD COLUMN "notes" TEXT;
ALTER TABLE "expenses" ADD COLUMN "is_business" BOOLEAN NOT NULL DEFAULT false;

-- Backfill. amount is Decimal(12,2), so scaling by 100 is exact; ROUND guards
-- against any stored value with more scale than the type advertises.
UPDATE "expenses" SET "amount_cents" = ROUND("amount" * 100)::INTEGER WHERE "amount_cents" IS NULL;

-- Fail loudly rather than install a NOT NULL that silently defaults to zero.
DO $$
DECLARE missing BIGINT;
BEGIN
  SELECT count(*) INTO missing FROM "expenses" WHERE "amount_cents" IS NULL;
  IF missing > 0 THEN
    RAISE EXCEPTION 'amount_cents backfill incomplete: % rows still null', missing;
  END IF;
END $$;

ALTER TABLE "expenses" ALTER COLUMN "amount_cents" SET NOT NULL;

-- Money must not be negative in either representation.
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_amount_cents_nonnegative" CHECK ("amount_cents" >= 0);
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_tax_cents_nonnegative" CHECK ("tax_cents" IS NULL OR "tax_cents" >= 0);
-- Tax is part of the total, never more than it.
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_tax_cents_within_total" CHECK ("tax_cents" IS NULL OR "tax_cents" <= "amount_cents");

CREATE INDEX "expenses_household_id_vendor_idx" ON "expenses"("household_id", "vendor");
