/**
 * Household backfill script.
 *
 * Run this AFTER migration 1 and BEFORE migration 2:
 *
 *   # Apply migration 1 only (adds tables, nullable columns)
 *   npx prisma db execute \
 *     --file prisma/migrations/20260501000001_add_household_tables_nullable/migration.sql \
 *     --schema prisma/schema.prisma
 *   npx prisma migrate resolve --applied 20260501000001_add_household_tables_nullable
 *
 *   # Run this backfill
 *   npx tsx prisma/backfill.ts
 *
 *   # Apply migration 2 (makes household_id NOT NULL, adds tenant constraints)
 *   npx prisma migrate deploy
 *
 * What it does:
 *   1. For each user: creates/reuses a household + OWNER membership.
 *   2. For each global category (household_id IS NULL): creates a household-
 *      specific copy, then remaps every expense in that household that still
 *      references the old global category ID.
 *   3. Moves any remaining NULL-household expenses (e.g. no category set).
 *   4. Deletes old global categories once no expenses reference them.
 *   5. Validates: zero NULL household_ids, zero cross-household category refs,
 *      and every expense owner belongs to the same household.
 *   6. Exits non-zero if validation fails.
 *
 * Safe to re-run (idempotent):
 *   - Households and memberships are upserted.
 *   - Category copies use ON CONFLICT (household_id, name) DO NOTHING.
 *   - Expense updates write the same values if run more than once.
 */

import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";

const prisma = new PrismaClient();

async function main() {
  // ── Count rows before ────────────────────────────────────────────────────
  const [userCount, beforeNullExpenses, beforeNullCategories, householdCount] =
    await Promise.all([
      prisma.user.count(),
      prisma.$queryRaw<
        [{ count: bigint }]
      >`SELECT COUNT(*) FROM expenses WHERE household_id IS NULL`,
      prisma.$queryRaw<
        [{ count: bigint }]
      >`SELECT COUNT(*) FROM categories WHERE household_id IS NULL`,
      prisma.household.count(),
    ]);

  console.log("── Before backfill ──────────────────────────────────────────");
  console.log(`  Users:              ${userCount}`);
  console.log(`  Households:         ${householdCount}`);
  console.log(`  Expenses w/ NULL:   ${Number(beforeNullExpenses[0]?.count ?? 0)}`);
  console.log(`  Categories w/ NULL: ${Number(beforeNullCategories[0]?.count ?? 0)}`);
  console.log("");

  // ── Read all global categories (household_id IS NULL) ─────────────────────
  const globalCategories = await prisma.$queryRaw<
    Array<{ id: string; name: string; status: string; sort_order: number }>
  >`SELECT id, name, status, sort_order FROM categories WHERE household_id IS NULL ORDER BY sort_order`;

  console.log(`Found ${globalCategories.length} global category/ies to distribute.`);

  // ── Process each user ─────────────────────────────────────────────────────
  const users = await prisma.user.findMany({ orderBy: { createdAt: "asc" } });

  for (const user of users) {
    const existingMembership = await prisma.membership.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: "asc" },
    });

    let householdId: string;

    if (existingMembership) {
      householdId = existingMembership.householdId;
      console.log(`  [EXIST] ${user.email} → household ${householdId}`);
    } else {
      const newId = randomUUID();
      await prisma.$executeRaw`
        INSERT INTO households (id, name, created_at, updated_at)
        VALUES (${newId}::uuid, ${`${user.name}'s Household`}, NOW(), NOW())
      `;
      await prisma.$executeRaw`
        INSERT INTO memberships (id, user_id, household_id, role, created_at)
        VALUES (${randomUUID()}::uuid, ${user.id}::uuid, ${newId}::uuid, 'OWNER', NOW())
      `;
      householdId = newId;
      console.log(`  [CREATE] Household for ${user.email} → ${householdId}`);
    }

    // For each global category: copy into this household, then remap expenses.
    let copiedCategories = 0;
    let remappedExpenses = 0;

    for (let i = 0; i < globalCategories.length; i++) {
      const cat = globalCategories[i]!;

      // Create household-specific copy (idempotent via ON CONFLICT DO NOTHING)
      const insertResult = await prisma.$executeRaw`
        INSERT INTO categories (id, household_id, name, status, sort_order, created_at, updated_at)
        VALUES (
          ${randomUUID()}::uuid,
          ${householdId}::uuid,
          ${cat.name},
          ${cat.status}::"CategoryStatus",
          ${i},
          NOW(),
          NOW()
        )
        ON CONFLICT (household_id, name) DO NOTHING
      `;
      if (insertResult > 0) copiedCategories++;

      // Resolve the id of the household-specific category (just inserted or pre-existing).
      const rows = await prisma.$queryRaw<[{ id: string }]>`
        SELECT id FROM categories
        WHERE household_id = ${householdId}::uuid AND name = ${cat.name}
        LIMIT 1
      `;
      const newCatId = rows[0]?.id;
      if (!newCatId) {
        throw new Error(
          `Could not find household category '${cat.name}' for household ${householdId}`
        );
      }

      // Remap expenses: set household_id AND update category_id to the
      // household-specific category. Targets any expense owned by this user
      // that still references the old global category ID.
      const remapped = await prisma.$executeRaw`
        UPDATE expenses
        SET household_id = ${householdId}::uuid,
            category_id  = ${newCatId}::uuid,
            updated_at   = NOW()
        WHERE user_id     = ${user.id}::uuid
          AND category_id = ${cat.id}::uuid
      `;
      remappedExpenses += remapped;
    }

    // Move any remaining expenses with NULL household_id that were not caught
    // above (e.g. category_id IS NULL, or category already household-specific
    // from a prior partial run).
    const moved = await prisma.$executeRaw`
      UPDATE expenses
      SET household_id = ${householdId}::uuid, updated_at = NOW()
      WHERE user_id = ${user.id}::uuid AND household_id IS NULL
    `;

    if (copiedCategories > 0)
      console.log(`    [COPY]  ${copiedCategories} category/ies → household`);
    if (remappedExpenses > 0)
      console.log(`    [REMAP] ${remappedExpenses} expense category/ies → household-specific`);
    if (moved > 0)
      console.log(`    [MOVE]  ${moved} expense(s) → household (no global category)`);
  }

  // ── Remove old global categories ──────────────────────────────────────────
  // All expenses should have been remapped; global categories are now safe to delete.
  if (globalCategories.length > 0) {
    const globalIds = globalCategories.map((c) => c.id);

    const stillReferenced = await prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*) FROM expenses
      WHERE category_id = ANY(${globalIds}::uuid[])
    `;
    const refCount = Number(stillReferenced[0]?.count ?? 0);

    if (refCount > 0) {
      // Validation below will catch this and exit non-zero.
      console.warn(
        `  [WARN]  ${refCount} expense(s) still reference global categories; skipping delete.`
      );
    } else {
      const deleted = await prisma.$executeRaw`DELETE FROM categories WHERE household_id IS NULL`;
      console.log(`  [DELETE] ${deleted} global category/ies removed.`);
    }
  }

  // ── Count rows after ──────────────────────────────────────────────────────
  const [afterNullExpenses, afterNullCategories, afterHouseholds, crossHousehold, missingMembership] =
    await Promise.all([
      prisma.$queryRaw<
        [{ count: bigint }]
      >`SELECT COUNT(*) FROM expenses WHERE household_id IS NULL`,
      prisma.$queryRaw<
        [{ count: bigint }]
      >`SELECT COUNT(*) FROM categories WHERE household_id IS NULL`,
      prisma.household.count(),
      // Expenses whose category belongs to a different household than the expense.
      prisma.$queryRaw<[{ count: bigint }]>`
        SELECT COUNT(*)
        FROM expenses e
        JOIN categories c ON e.category_id = c.id
        WHERE e.household_id IS DISTINCT FROM c.household_id
      `,
      prisma.$queryRaw<[{ count: bigint }]>`
        SELECT COUNT(*)
        FROM expenses e
        LEFT JOIN memberships m
          ON m.user_id = e.user_id
         AND m.household_id = e.household_id
        WHERE m.id IS NULL
      `,
    ]);

  const afterNullExp = Number(afterNullExpenses[0]?.count ?? 0);
  const afterNullCat = Number(afterNullCategories[0]?.count ?? 0);
  const crossCount = Number(crossHousehold[0]?.count ?? 0);
  const missingMembershipCount = Number(missingMembership[0]?.count ?? 0);

  console.log("");
  console.log("── After backfill ───────────────────────────────────────────");
  console.log(`  Households:                      ${afterHouseholds}`);
  console.log(`  Expenses still w/ NULL:          ${afterNullExp}`);
  console.log(`  Categories still w/ NULL:        ${afterNullCat}`);
  console.log(`  Expenses w/ cross-household cat: ${crossCount}`);
  console.log(`  Expenses missing membership:     ${missingMembershipCount}`);

  // ── Validation ────────────────────────────────────────────────────────────
  const failed =
    afterNullExp > 0 ||
    afterNullCat > 0 ||
    crossCount > 0 ||
    missingMembershipCount > 0;
  if (failed) {
    if (afterNullExp > 0)
      console.error(`\n[FAIL] ${afterNullExp} expense(s) still have NULL household_id.`);
    if (afterNullCat > 0)
      console.error(`[FAIL] ${afterNullCat} category/ies still have NULL household_id.`);
    if (crossCount > 0)
      console.error(
        `[FAIL] ${crossCount} expense(s) have a category from a different household.`
      );
    if (missingMembershipCount > 0)
      console.error(
        `[FAIL] ${missingMembershipCount} expense(s) do not have a matching membership for (user_id, household_id).`
      );
    console.error("\nBackfill incomplete. Do NOT run migration 2.");
    process.exit(1);
  }

  console.log("\nAll checks passed. Safe to run migration 2.");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
