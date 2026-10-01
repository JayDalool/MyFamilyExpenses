-- Add paid_by_user_id to expenses.
--
-- Distinguishes two concepts that used to be conflated on user_id:
--   user_id          = who entered/uploaded the expense (audit owner). UNCHANGED.
--   paid_by_user_id  = the assigned household member the spending is attributed to.
--
-- Safe as a single migration: the backfill source (user_id) is already guaranteed
-- to reference a membership in the same household via
-- expenses_user_household_membership_fkey, so the new composite FK below will hold
-- for every backfilled row.

-- 1. Add nullable column.
ALTER TABLE "expenses" ADD COLUMN "paid_by_user_id" UUID;

-- 2. Backfill existing expenses: attribute spending to whoever entered them.
UPDATE "expenses" SET "paid_by_user_id" = "user_id" WHERE "paid_by_user_id" IS NULL;

-- 3. Make it required.
ALTER TABLE "expenses" ALTER COLUMN "paid_by_user_id" SET NOT NULL;

-- 4. Composite FK: the paid-by member must belong to the same household as the expense.
--    Mirrors expenses_user_household_membership_fkey. References the membership row,
--    which persists for removed members (soft delete via removed_at), so historic
--    reports for former members continue to resolve.
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_paid_by_user_id_household_id_fkey"
    FOREIGN KEY ("paid_by_user_id", "household_id")
    REFERENCES "memberships"("user_id", "household_id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- 5. Direct FK to users(id), matching the paidByUser relation in schema.prisma.
--    Mirrors expenses_user_id_fkey for the entered-by relation. Redundant for
--    integrity (the composite FK above already pins paid_by_user_id to a valid
--    membership, hence a valid user) but required so the database matches the
--    relation declared on the Prisma model.
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_paid_by_user_id_fkey"
    FOREIGN KEY ("paid_by_user_id")
    REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- 6. Reporting index: member spending rollups group/filter by (household_id, paid_by_user_id).
CREATE INDEX "expenses_household_id_paid_by_user_id_idx"
    ON "expenses"("household_id", "paid_by_user_id");

