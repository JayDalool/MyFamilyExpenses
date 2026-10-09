import type { Prisma } from "@prisma/client";
import { expenseReadScope } from "@/lib/auth/permissions";
import type { AuthContext } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { normalizeVendor, vendorMatches } from "@/lib/ocr/benchmark";

export type VendorCategoryRow = {
  vendor: string;
  categoryId: string;
  count: number;
  lastSavedAt: Date;
};

export type CategorySuggestion = {
  categoryId: string;
  /** Saved expenses for this vendor filed under the suggested category. */
  count: number;
  /** All saved expenses that matched this vendor. */
  total: number;
};

function rowMatches(rowVendor: string, key: string) {
  const a = normalizeVendor(rowVendor);
  const b = normalizeVendor(key);
  if (!a || !b) return false;
  // Equal names match (lets short names such as "A&W" work); otherwise use
  // the same containment rule the OCR scorecard uses.
  return a === b || vendorMatches(rowVendor, key);
}

/** Most frequent category wins; a tie goes to the most recently saved. */
export function pickCategorySuggestion(
  rows: VendorCategoryRow[],
  key: string,
): CategorySuggestion | null {
  const perCategory = new Map<string, { count: number; last: number }>();
  let total = 0;

  for (const row of rows) {
    if (!rowMatches(row.vendor, key)) continue;
    total += row.count;
    const entry = perCategory.get(row.categoryId) ?? { count: 0, last: 0 };
    entry.count += row.count;
    entry.last = Math.max(entry.last, row.lastSavedAt.getTime());
    perCategory.set(row.categoryId, entry);
  }

  let best: { categoryId: string; count: number; last: number } | null = null;
  for (const [categoryId, entry] of perCategory) {
    if (!best || entry.count > best.count || (entry.count === best.count && entry.last > best.last)) {
      best = { categoryId, ...entry };
    }
  }

  return best ? { categoryId: best.categoryId, count: best.count, total } : null;
}

export async function suggestCategoryForVendor(
  auth: AuthContext,
  key: string,
  db: Pick<typeof prisma, "expense"> = prisma,
): Promise<CategorySuggestion | null> {
  const where: Prisma.ExpenseWhereInput = {
    householdId: auth.householdId,
    deletedAt: null,
    vendor: { not: null },
    category: { status: "ACTIVE" },
    ...expenseReadScope(auth),
  };

  const groups = await db.expense.groupBy({
    by: ["vendor", "categoryId"],
    where,
    _count: { _all: true },
    _max: { updatedAt: true },
  });

  const rows: VendorCategoryRow[] = [];
  for (const group of groups) {
    if (!group.vendor) continue;
    rows.push({
      vendor: group.vendor,
      categoryId: group.categoryId,
      count: group._count._all,
      lastSavedAt: group._max.updatedAt ?? new Date(0),
    });
  }

  return pickCategorySuggestion(rows, key);
}
