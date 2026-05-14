import type { Prisma } from "@prisma/client";
import type { AuthContext } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import {
  expenseHistoryFiltersSchema,
  type ExpenseHistoryFilters,
} from "@/lib/validation/expense";

type RawSearchParams = Record<string, string | string[] | undefined>;

function getSingleSearchParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export function normalizeExpenseHistoryFilters(
  searchParams: RawSearchParams = {},
): ExpenseHistoryFilters {
  const parsed = expenseHistoryFiltersSchema.safeParse({
    invoiceNumber: getSingleSearchParam(searchParams.invoiceNumber),
    categoryId: getSingleSearchParam(searchParams.categoryId),
    fromDate: getSingleSearchParam(searchParams.fromDate),
    toDate: getSingleSearchParam(searchParams.toDate),
  });

  if (!parsed.success) {
    return {};
  }

  return parsed.data;
}

export function buildExpenseWhereInput(
  auth: AuthContext,
  filters: ExpenseHistoryFilters = {},
): Prisma.ExpenseWhereInput {
  const where: Prisma.ExpenseWhereInput = {
    householdId: auth.householdId,
  };

  if (filters.invoiceNumber) {
    where.invoiceNumber = { contains: filters.invoiceNumber, mode: "insensitive" };
  }

  if (filters.categoryId) {
    where.categoryId = filters.categoryId;
  }

  if (filters.fromDate || filters.toDate) {
    where.invoiceDate = {};

    if (filters.fromDate) {
      where.invoiceDate.gte = new Date(`${filters.fromDate}T00:00:00.000Z`);
    }

    if (filters.toDate) {
      where.invoiceDate.lte = new Date(`${filters.toDate}T23:59:59.999Z`);
    }
  }

  return where;
}

export async function listExpensesForUser(
  auth: AuthContext,
  filters: ExpenseHistoryFilters = {},
) {
  return prisma.expense.findMany({
    where: buildExpenseWhereInput(auth, filters),
    include: { category: true, user: true },
    orderBy: [{ invoiceDate: "desc" }, { createdAt: "desc" }],
  });
}

export async function getExpenseForUser(auth: AuthContext, expenseId: string) {
  return prisma.expense.findFirst({
    where: {
      id: expenseId,
      householdId: auth.householdId,
    },
    include: { category: true, user: true },
  });
}
