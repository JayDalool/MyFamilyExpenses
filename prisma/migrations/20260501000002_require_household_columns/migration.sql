-- Migration 2 of 2: Make household_id required and add tenant integrity constraints.
--
-- This migration MUST be run after the backfill script.
-- See migration 1 header or CHECKLIST.md for the full three-step sequence.
--
-- If any rows still have household_id = NULL, the ALTER COLUMN NOT NULL will fail
-- with a clear Postgres error. Fix by re-running the backfill script.

-- Make household_id NOT NULL on categories
-- (fails loudly if backfill was not run)
ALTER TABLE "categories" ALTER COLUMN "household_id" SET NOT NULL;

-- Make household_id NOT NULL on expenses
ALTER TABLE "expenses" ALTER COLUMN "household_id" SET NOT NULL;

-- Compound unique on categories(id, household_id) — required for the compound FK below
-- Note: categories_household_id_name_key was created in migration 1 so the backfill
-- could use ON CONFLICT (household_id, name). It is not repeated here.
CREATE UNIQUE INDEX "categories_id_household_id_key" ON "categories"("id", "household_id");

-- Foreign key: categories.household_id → households.id
ALTER TABLE "categories" ADD CONSTRAINT "categories_household_id_fkey"
    FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Foreign key: expenses.household_id → households.id
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_household_id_fkey"
    FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Composite FK: expense owner must belong to the same household.
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_user_household_membership_fkey"
    FOREIGN KEY ("user_id", "household_id")
    REFERENCES "memberships"("user_id", "household_id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- Compound FK: expense category must belong to the same household as the expense.
-- Drop the old single-field FK first, then replace with compound version.
ALTER TABLE "expenses" DROP CONSTRAINT "expenses_category_id_fkey";
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_category_household_fkey"
    FOREIGN KEY ("category_id", "household_id")
    REFERENCES "categories"("id", "household_id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
