import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";

type CategoryStore = Pick<typeof prisma, "category" | "expense">;

export async function updateCategoryForHousehold(
  householdId: string,
  categoryId: string,
  data: Prisma.CategoryUpdateManyMutationInput,
  db: CategoryStore = prisma,
) {
  const result = await db.category.updateMany({
    where: { id: categoryId, householdId },
    data,
  });

  if (result.count === 0) return null;
  return db.category.findFirst({ where: { id: categoryId, householdId } });
}

export async function deleteOrDisableCategoryForHousehold(
  householdId: string,
  categoryId: string,
  db: CategoryStore = prisma,
) {
  const category = await db.category.findFirst({
    where: { id: categoryId, householdId },
  });
  if (!category) return null;

  const expenseCount = await db.expense.count({
    where: { categoryId, householdId },
  });

  if (expenseCount > 0) {
    const updated = await updateCategoryForHousehold(
      householdId,
      categoryId,
      { status: "DISABLED" },
      db,
    );
    return { category: updated!, mode: "disabled" as const, expenseCount };
  }

  const deleted = await db.category.deleteMany({
    where: { id: categoryId, householdId },
  });
  if (deleted.count === 0) return null;
  return { category, mode: "deleted" as const, expenseCount: 0 };
}
