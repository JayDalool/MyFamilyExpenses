import type { Prisma } from "@prisma/client";
import type { AuthContext } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { canAssignExpenseToOthers } from "@/lib/auth/permissions";
import {
  expenseHistoryFiltersSchema,
  type ExpenseHistoryFilters,
} from "@/lib/validation/expense";

const expenseRelationInclude = {
  category: true,
  user: true,
  paidByUser: { select: { id: true, name: true } },
} satisfies Prisma.ExpenseInclude;

/**
 * Resolve and authorize the paid-by member for a create/update.
 *
 * - When omitted, defaults to the current user (always a member of the active household).
 * - When it equals the current user, it is allowed.
 * - When it targets another member, the caller must be allowed to assign on behalf
 *   of others (OWNER/ADMIN) AND the target must be an active member of the active
 *   household. Otherwise returns null so the caller can reject with a 400.
 */
export async function resolvePaidByUserId(
  auth: AuthContext,
  requested: string | undefined,
  db: Pick<typeof prisma, "membership"> = prisma,
): Promise<string | null> {
  if (!requested || requested === auth.user.id) {
    return auth.user.id;
  }

  if (!canAssignExpenseToOthers(auth)) {
    return null;
  }

  const membership = await db.membership.findFirst({
    where: { userId: requested, householdId: auth.householdId, removedAt: null },
    select: { userId: true },
  });

  return membership ? membership.userId : null;
}

export type PaidByEditDecision =
  | { ok: true; paidByUserId: string }
  | { ok: false; status: 400 | 403; message: string };

/**
 * Authorize a paid-by attribution change on an *existing* expense.
 *
 * Stricter than create: reassigning attribution after creation is OWNER/ADMIN-only.
 * A MEMBER cannot change paid-by at all once the expense exists — not even back to
 * themselves — so an owner/admin assignment to another member can never be silently
 * reclaimed.
 *
 * - No change requested (omitted or equal to the current value) → keep current value,
 *   so editing other fields never trips the assignment check.
 * - A real change by a non-OWNER/ADMIN → 403.
 * - A real change to an inactive or cross-household member → 400.
 */
export async function resolvePaidByUserIdForEdit(
  auth: AuthContext,
  requested: string | undefined,
  currentPaidByUserId: string,
  db: Pick<typeof prisma, "membership"> = prisma,
): Promise<PaidByEditDecision> {
  if (!requested || requested === currentPaidByUserId) {
    return { ok: true, paidByUserId: currentPaidByUserId };
  }

  if (!canAssignExpenseToOthers(auth)) {
    return {
      ok: false,
      status: 403,
      message: "Only an owner or admin can change who an expense is attributed to.",
    };
  }

  const resolved = await resolvePaidByUserId(auth, requested, db);
  if (!resolved) {
    return {
      ok: false,
      status: 400,
      message: "You can only assign expenses to active household members.",
    };
  }

  return { ok: true, paidByUserId: resolved };
}

type RawSearchParams = Record<string, string | string[] | undefined>;
type ExpenseStore = Pick<typeof prisma, "category" | "expense">;

const DEFAULT_EXPENSE_PAGE_SIZE = 10;
const MAX_EXPENSE_PAGE_SIZE = 50;

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
    page: getSingleSearchParam(searchParams.page),
    pageSize: getSingleSearchParam(searchParams.pageSize),
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
    deletedAt: null,
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

export function getActiveExpenseScope(householdId: string): Prisma.ExpenseWhereInput {
  return { householdId, deletedAt: null };
}

export function getExpensePagination(filters: ExpenseHistoryFilters = {}) {
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(
    MAX_EXPENSE_PAGE_SIZE,
    Math.max(1, filters.pageSize ?? DEFAULT_EXPENSE_PAGE_SIZE),
  );

  return { page, pageSize, skip: (page - 1) * pageSize };
}

export async function listExpensesPageForUser(
  auth: AuthContext,
  filters: ExpenseHistoryFilters = {},
  db: ExpenseStore = prisma,
) {
  const where = buildExpenseWhereInput(auth, filters);
  const requestedPagination = getExpensePagination(filters);
  const total = await db.expense.count({ where });
  const totalPages = Math.max(1, Math.ceil(total / requestedPagination.pageSize));
  const page = Math.min(requestedPagination.page, totalPages);
  const skip = (page - 1) * requestedPagination.pageSize;

  const expenses = await db.expense.findMany({
    where,
    include: expenseRelationInclude,
    orderBy: [{ invoiceDate: "desc" }, { createdAt: "desc" }],
    skip,
    take: requestedPagination.pageSize,
  });

  return {
    expenses,
    pagination: {
      page,
      pageSize: requestedPagination.pageSize,
      total,
      totalPages,
    },
  };
}

export async function listExpensesForUser(
  auth: AuthContext,
  filters: ExpenseHistoryFilters = {},
  db: ExpenseStore = prisma,
) {
  return (await listExpensesPageForUser(auth, filters, db)).expenses;
}

export async function getExpenseForUser(
  auth: AuthContext,
  expenseId: string,
  db: ExpenseStore = prisma,
) {
  return db.expense.findFirst({
    where: {
      id: expenseId,
      householdId: auth.householdId,
      deletedAt: null,
    },
    include: expenseRelationInclude,
  });
}

export async function findAllowedExpenseCategoryForUpdate(
  auth: AuthContext,
  requestedCategoryId: string,
  currentCategoryId: string,
  db: ExpenseStore = prisma,
) {
  return db.category.findFirst({
    where: {
      id: requestedCategoryId,
      householdId: auth.householdId,
      OR: [{ status: "ACTIVE" }, { id: currentCategoryId }],
    },
  });
}

export async function updateExpenseForUser(
  auth: AuthContext,
  expenseId: string,
  data: Prisma.ExpenseUncheckedUpdateManyInput,
  db: ExpenseStore = prisma,
) {
  if (auth.householdRole === "VIEWER") {
    return null;
  }

  const result = await db.expense.updateMany({
    where: {
      id: expenseId,
      householdId: auth.householdId,
      deletedAt: null,
      ...(auth.householdRole === "MEMBER" ? { userId: auth.user.id } : {}),
    },
    data,
  });

  if (result.count === 0) return null;
  return getExpenseForUser(auth, expenseId, db);
}

export async function softDeleteExpenseForUser(
  auth: AuthContext,
  expenseId: string,
  deletedByUserId: string,
  db: ExpenseStore = prisma,
) {
  if (auth.householdRole === "VIEWER") {
    return null;
  }

  const result = await db.expense.updateMany({
    where: {
      id: expenseId,
      householdId: auth.householdId,
      deletedAt: null,
      ...(auth.householdRole === "MEMBER" ? { userId: auth.user.id } : {}),
    },
    data: {
      deletedAt: new Date(),
      deletedByUserId,
    },
  });

  if (result.count === 0) return null;
  return db.expense.findFirst({
    where: { id: expenseId, householdId: auth.householdId },
  });
}
