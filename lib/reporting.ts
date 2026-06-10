import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";

type RawSearchParams = Record<string, string | string[] | undefined>;
type ReportingStore = Pick<typeof prisma, "category" | "expense" | "user"> & {
  $queryRaw: typeof prisma.$queryRaw;
};
type AccountantStore = ReportingStore;

export type ReportPeriod = "today" | "week" | "month" | "year" | "custom";

export type ReportFilters = {
  period: ReportPeriod;
  fromDate?: string;
  toDate?: string;
  categoryId?: string;
  memberUserId?: string;
  page: number;
  pageSize: number;
};

export type ReportFilterParseResult =
  | { ok: true; filters: ReportFilters }
  | { ok: false; filters: ReportFilters; error: string };

export const MAX_SYNC_EXPORT_ROWS = 5000;
export const INVALID_CUSTOM_DATE_RANGE_MESSAGE = "Invalid custom date range.";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DEFAULT_REPORT_PAGE_SIZE = 10;
const MAX_REPORT_PAGE_SIZE = 50;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function single(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function positiveInteger(value: string | undefined, fallback: number, max: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
}

export function parseStrictDateOnly(value: string): Date | null {
  if (!DATE_PATTERN.test(value)) return null;

  const [year, month, day] = value.split("-").map(Number);
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    month! < 1 ||
    month! > 12 ||
    day! < 1
  ) {
    return null;
  }

  const daysInMonth = new Date(Date.UTC(year!, month!, 0)).getUTCDate();
  if (day! > daysInMonth) return null;

  const parsed = new Date(Date.UTC(year!, month! - 1, day!));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month! - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }

  return parsed;
}

export function parseReportFilters(searchParams: RawSearchParams = {}): ReportFilterParseResult {
  const requestedPeriod = single(searchParams.period);
  const period: ReportPeriod = ["today", "week", "month", "year", "custom"].includes(
    requestedPeriod ?? "",
  )
    ? (requestedPeriod as ReportPeriod)
    : "month";
  const requestedFromDate = single(searchParams.fromDate);
  const requestedToDate = single(searchParams.toDate);

  const requestedCategoryId = single(searchParams.categoryId);
  const requestedMemberUserId = single(searchParams.memberUserId);
  const categoryId =
    requestedCategoryId && UUID_PATTERN.test(requestedCategoryId)
      ? requestedCategoryId
      : undefined;
  const memberUserId =
    requestedMemberUserId && UUID_PATTERN.test(requestedMemberUserId)
      ? requestedMemberUserId
      : undefined;

  const filters: ReportFilters = {
    period,
    fromDate: period === "custom" ? requestedFromDate : undefined,
    toDate: period === "custom" ? requestedToDate : undefined,
    categoryId,
    memberUserId,
    page: positiveInteger(single(searchParams.page), 1, 9999),
    pageSize: positiveInteger(
      single(searchParams.pageSize),
      DEFAULT_REPORT_PAGE_SIZE,
      MAX_REPORT_PAGE_SIZE,
    ),
  };

  if (period === "custom") {
    const from = requestedFromDate ? parseStrictDateOnly(requestedFromDate) : null;
    const to = requestedToDate ? parseStrictDateOnly(requestedToDate) : null;
    if (!from || !to || from > to) {
      return { ok: false, filters, error: INVALID_CUSTOM_DATE_RANGE_MESSAGE };
    }
  }

  return { ok: true, filters };
}

export function normalizeReportFilters(searchParams: RawSearchParams = {}): ReportFilters {
  const result = parseReportFilters(searchParams);
  if (!result.ok) {
    throw new RangeError(result.error);
  }
  return result.filters;
}

function getDateParts(reference: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(reference);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);

  return { year: value("year"), month: value("month"), day: value("day") };
}

function dateOnly(year: number, month: number, day: number) {
  return new Date(Date.UTC(year, month - 1, day));
}

export function getReportDateRange(
  filters: Pick<ReportFilters, "period" | "fromDate" | "toDate">,
  reference = new Date(),
  timeZone = process.env.APP_TIME_ZONE ?? "UTC",
) {
  const { year, month, day } = getDateParts(reference, timeZone);
  const today = dateOnly(year, month, day);

  if (filters.period === "custom") {
    const from = filters.fromDate ? parseStrictDateOnly(filters.fromDate) : null;
    const to = filters.toDate ? parseStrictDateOnly(filters.toDate) : null;
    if (!from || !to || from > to) {
      throw new RangeError(INVALID_CUSTOM_DATE_RANGE_MESSAGE);
    }
    return { from, to };
  }

  if (filters.period === "today") return { from: today, to: today };
  if (filters.period === "week") {
    const dayOfWeek = today.getUTCDay();
    const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    return {
      from: dateOnly(year, month, day - daysFromMonday),
      to: dateOnly(year, month, day + (6 - daysFromMonday)),
    };
  }
  if (filters.period === "year") {
    return { from: dateOnly(year, 1, 1), to: dateOnly(year, 12, 31) };
  }

  return {
    from: dateOnly(year, month, 1),
    to: dateOnly(year, month + 1, 0),
  };
}

function activeExpenseWhere(
  householdId: string,
  range?: { from: Date; to: Date },
  extras?: { categoryId?: string; memberUserId?: string },
): Prisma.ExpenseWhereInput {
  return {
    householdId,
    deletedAt: null,
    ...(range ? { invoiceDate: { gte: range.from, lte: range.to } } : {}),
    ...(extras?.categoryId ? { categoryId: extras.categoryId } : {}),
    // Member spending is attributed to the paid-by member, not the uploader.
    ...(extras?.memberUserId ? { paidByUserId: extras.memberUserId } : {}),
  };
}

export async function getDashboardSummary(
  householdId: string,
  db: ReportingStore = prisma,
  reference = new Date(),
) {
  const todayRange = getReportDateRange({ period: "today" }, reference);
  const monthRange = getReportDateRange({ period: "month" }, reference);
  const [today, month, allTime, recentExpenses] = await Promise.all([
    db.expense.aggregate({
      where: activeExpenseWhere(householdId, todayRange),
      _sum: { amount: true },
      _count: { _all: true },
    }),
    db.expense.aggregate({
      where: activeExpenseWhere(householdId, monthRange),
      _sum: { amount: true },
      _count: { _all: true },
    }),
    db.expense.aggregate({
      where: activeExpenseWhere(householdId),
      _sum: { amount: true },
      _count: { _all: true },
    }),
    db.expense.findMany({
      where: activeExpenseWhere(householdId),
      include: {
        category: true,
        user: true,
        paidByUser: { select: { id: true, name: true } },
      },
      orderBy: [{ invoiceDate: "desc" }, { createdAt: "desc" }],
      take: 6,
    }),
  ]);

  return { today, month, allTime, recentExpenses };
}

type AnalyticsStore = Pick<typeof prisma, "expense" | "category" | "user"> & {
  $queryRaw: typeof prisma.$queryRaw;
};

export type DashboardAnalytics = {
  generatedAt: Date;
  thisMonth: { total: number; count: number };
  lastMonth: { total: number; count: number };
  thisYear: { total: number; count: number };
  averageMonthly: { total: number; months: number };
  highestCategoryThisMonth:
    | { categoryId: string; name: string; total: number }
    | null;
  topSpenderThisMonth:
    | { userId: string; name: string; total: number }
    | null;
  monthlyTrend: Array<{ month: string; total: number; count: number }>;
  categoryBreakdownThisYear: Array<{
    categoryId: string;
    name: string;
    total: number;
    count: number;
  }>;
  memberBreakdownThisYear: Array<{
    userId: string;
    name: string;
    total: number;
    count: number;
  }>;
  dailyTrendThisMonth: Array<{ day: string; total: number; count: number }>;
  expenseCount: { thisMonth: number; thisYear: number; allTime: number };
};

function shiftMonths(year: number, month: number, delta: number) {
  const total = (year * 12 + (month - 1)) + delta;
  return { year: Math.floor(total / 12), month: (total % 12) + 1 };
}

function lastDayOfMonth(year: number, month: number) {
  // dateOnly(year, month + 1, 0) returns last day of month — same trick as
  // getReportDateRange for "month".
  return dateOnly(year, month + 1, 0).getUTCDate();
}

/**
 * Aggregate the analytics shown on the dashboard. Pulls 12-month rolling
 * trend, year-to-date category and member breakdowns, daily totals for the
 * current month, and the headline cards. All queries are household-scoped and
 * exclude soft-deleted expenses, mirroring getDashboardSummary.
 */
export async function getDashboardAnalytics(
  householdId: string,
  db: AnalyticsStore = prisma,
  reference = new Date(),
  timeZone = process.env.APP_TIME_ZONE ?? "UTC",
): Promise<DashboardAnalytics> {
  const { year, month } = getDateParts(reference, timeZone);
  const thisMonthRange = getReportDateRange({ period: "month" }, reference, timeZone);
  const yearRange = getReportDateRange({ period: "year" }, reference, timeZone);
  const lastMonthShift = shiftMonths(year, month, -1);
  const lastMonthRange = {
    from: dateOnly(lastMonthShift.year, lastMonthShift.month, 1),
    to: dateOnly(
      lastMonthShift.year,
      lastMonthShift.month,
      lastDayOfMonth(lastMonthShift.year, lastMonthShift.month),
    ),
  };
  const trendStartShift = shiftMonths(year, month, -11);
  const trendStart = dateOnly(trendStartShift.year, trendStartShift.month, 1);
  const trendEnd = dateOnly(year, month, lastDayOfMonth(year, month));

  const [
    thisMonthAgg,
    lastMonthAgg,
    yearAgg,
    trendRows,
    categoryGroupsYear,
    memberGroupsYear,
    categoryGroupsMonth,
    memberGroupsMonth,
    dailyRows,
    allTimeAgg,
  ] = await Promise.all([
    db.expense.aggregate({
      where: activeExpenseWhere(householdId, thisMonthRange),
      _sum: { amount: true },
      _count: { _all: true },
    }),
    db.expense.aggregate({
      where: activeExpenseWhere(householdId, lastMonthRange),
      _sum: { amount: true },
      _count: { _all: true },
    }),
    db.expense.aggregate({
      where: activeExpenseWhere(householdId, yearRange),
      _sum: { amount: true },
      _count: { _all: true },
    }),
    db.$queryRaw<Array<{ bucket: Date; total: string; count: bigint }>>`
      SELECT
        DATE_TRUNC('month', "invoice_date")::date AS "bucket",
        COALESCE(SUM("amount"), 0)::text         AS "total",
        COUNT(*)::bigint                          AS "count"
      FROM "expenses"
      WHERE "household_id" = CAST(${householdId} AS uuid)
        AND "deleted_at" IS NULL
        AND "invoice_date" >= ${trendStart}
        AND "invoice_date" <= ${trendEnd}
      GROUP BY "bucket"
      ORDER BY "bucket" ASC
    `,
    db.expense.groupBy({
      by: ["categoryId"],
      where: activeExpenseWhere(householdId, yearRange),
      _sum: { amount: true },
      _count: { _all: true },
    }),
    db.expense.groupBy({
      by: ["paidByUserId"],
      where: activeExpenseWhere(householdId, yearRange),
      _sum: { amount: true },
      _count: { _all: true },
    }),
    db.expense.groupBy({
      by: ["categoryId"],
      where: activeExpenseWhere(householdId, thisMonthRange),
      _sum: { amount: true },
      _count: { _all: true },
    }),
    db.expense.groupBy({
      by: ["paidByUserId"],
      where: activeExpenseWhere(householdId, thisMonthRange),
      _sum: { amount: true },
      _count: { _all: true },
    }),
    db.$queryRaw<Array<{ bucket: Date; total: string; count: bigint }>>`
      SELECT
        "invoice_date"::date              AS "bucket",
        COALESCE(SUM("amount"), 0)::text  AS "total",
        COUNT(*)::bigint                  AS "count"
      FROM "expenses"
      WHERE "household_id" = CAST(${householdId} AS uuid)
        AND "deleted_at" IS NULL
        AND "invoice_date" >= ${thisMonthRange.from}
        AND "invoice_date" <= ${thisMonthRange.to}
      GROUP BY "bucket"
      ORDER BY "bucket" ASC
    `,
    db.expense.aggregate({
      where: activeExpenseWhere(householdId),
      _count: { _all: true },
    }),
  ]);

  const categoryIds = Array.from(
    new Set([
      ...categoryGroupsYear.map((g) => g.categoryId),
      ...categoryGroupsMonth.map((g) => g.categoryId),
    ]),
  );
  const userIds = Array.from(
    new Set([
      ...memberGroupsYear.map((g) => g.paidByUserId),
      ...memberGroupsMonth.map((g) => g.paidByUserId),
    ]),
  );
  const [categoryRows, userRows] = await Promise.all([
    categoryIds.length
      ? db.category.findMany({
          where: { householdId, id: { in: categoryIds } },
          select: { id: true, name: true },
        })
      : Promise.resolve([] as Array<{ id: string; name: string }>),
    userIds.length
      ? db.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, name: true },
        })
      : Promise.resolve([] as Array<{ id: string; name: string }>),
  ]);
  const categoryNames = new Map(categoryRows.map((row) => [row.id, row.name]));
  const userNames = new Map(userRows.map((row) => [row.id, row.name]));

  const monthlyTrend = buildMonthlyTrend(trendStart, trendEnd, trendRows);
  const dailyTrendThisMonth = buildDailyTrend(thisMonthRange, dailyRows);

  const categoryBreakdownThisYear = categoryGroupsYear
    .map((row) => ({
      categoryId: row.categoryId,
      name: categoryNames.get(row.categoryId) ?? "Unknown category",
      total: Number(row._sum.amount ?? 0),
      count: row._count._all,
    }))
    .sort((left, right) => right.total - left.total);

  const memberBreakdownThisYear = memberGroupsYear
    .map((row) => ({
      userId: row.paidByUserId,
      name: userNames.get(row.paidByUserId) ?? "Unknown member",
      total: Number(row._sum.amount ?? 0),
      count: row._count._all,
    }))
    .sort((left, right) => right.total - left.total);

  const highestCategoryThisMonth = categoryGroupsMonth.length
    ? categoryGroupsMonth
        .map((row) => ({
          categoryId: row.categoryId,
          name: categoryNames.get(row.categoryId) ?? "Unknown category",
          total: Number(row._sum.amount ?? 0),
        }))
        .sort((left, right) => right.total - left.total)[0]
    : null;

  const topSpenderThisMonth = memberGroupsMonth.length
    ? memberGroupsMonth
        .map((row) => ({
          userId: row.paidByUserId,
          name: userNames.get(row.paidByUserId) ?? "Unknown member",
          total: Number(row._sum.amount ?? 0),
        }))
        .sort((left, right) => right.total - left.total)[0]
    : null;

  const trendMonthsWithSpend = monthlyTrend.filter((m) => m.total > 0).length;
  const averageMonthly = {
    total: trendMonthsWithSpend > 0
      ? monthlyTrend.reduce((sum, m) => sum + m.total, 0) / trendMonthsWithSpend
      : 0,
    months: trendMonthsWithSpend,
  };

  return {
    generatedAt: new Date(),
    thisMonth: {
      total: Number(thisMonthAgg._sum.amount ?? 0),
      count: thisMonthAgg._count._all,
    },
    lastMonth: {
      total: Number(lastMonthAgg._sum.amount ?? 0),
      count: lastMonthAgg._count._all,
    },
    thisYear: {
      total: Number(yearAgg._sum.amount ?? 0),
      count: yearAgg._count._all,
    },
    averageMonthly,
    highestCategoryThisMonth: highestCategoryThisMonth ?? null,
    topSpenderThisMonth: topSpenderThisMonth ?? null,
    monthlyTrend,
    categoryBreakdownThisYear,
    memberBreakdownThisYear,
    dailyTrendThisMonth,
    expenseCount: {
      thisMonth: thisMonthAgg._count._all,
      thisYear: yearAgg._count._all,
      allTime: allTimeAgg._count._all,
    },
  };
}

function buildMonthlyTrend(
  start: Date,
  end: Date,
  rows: Array<{ bucket: Date; total: string; count: bigint }>,
) {
  const byKey = new Map(
    rows.map((row) => [
      `${row.bucket.getUTCFullYear()}-${String(row.bucket.getUTCMonth() + 1).padStart(2, "0")}`,
      { total: Number(row.total), count: Number(row.count) },
    ]),
  );
  const trend: Array<{ month: string; total: number; count: number }> = [];
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  const stop = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));
  while (cursor <= stop) {
    const key = `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, "0")}`;
    const value = byKey.get(key) ?? { total: 0, count: 0 };
    trend.push({ month: key, total: value.total, count: value.count });
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return trend;
}

function buildDailyTrend(
  range: { from: Date; to: Date },
  rows: Array<{ bucket: Date; total: string; count: bigint }>,
) {
  const byKey = new Map(
    rows.map((row) => [
      row.bucket.toISOString().slice(0, 10),
      { total: Number(row.total), count: Number(row.count) },
    ]),
  );
  const trend: Array<{ day: string; total: number; count: number }> = [];
  const cursor = new Date(range.from);
  while (cursor <= range.to) {
    const key = cursor.toISOString().slice(0, 10);
    const value = byKey.get(key) ?? { total: 0, count: 0 };
    trend.push({ day: key, total: value.total, count: value.count });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return trend;
}

export type AccountantReport = {
  household: { id: string; name: string };
  range: { from: Date; to: Date };
  generatedAt: Date;
  filters: {
    period: ReportPeriod;
    categoryId?: string;
    memberUserId?: string;
  };
  totals: { total: number; count: number; average: number };
  categoryBreakdown: Array<{
    categoryId: string;
    name: string;
    total: number;
    count: number;
  }>;
  memberBreakdown: Array<{
    userId: string;
    name: string;
    total: number;
    count: number;
  }>;
  monthlyTotals: Array<{ month: string; total: number; count: number }>;
  expenses: Array<{
    id: string;
    invoiceNumber: string;
    invoiceDate: Date;
    amount: number;
    categoryId: string;
    categoryName: string;
    // paid-by member (spending attribution)
    userId: string;
    userName: string;
    // entered-by / uploader (audit owner)
    enteredByUserId: string;
    enteredByUserName: string;
    filePath: string;
  }>;
};

/**
 * Build the full accountant-ready report. Unlike getReportData, this returns
 * EVERY active expense in the range (no pagination) along with breakdowns by
 * category, member, and month. Suitable for direct export to PDF/CSV/XLSX.
 *
 * Caller is responsible for already having verified the requester is a
 * household member; this function intentionally only takes a householdId so
 * it is testable without an AuthContext.
 */
export async function buildAccountantReport(
  household: { id: string; name: string },
  filters: ReportFilters,
  db: AccountantStore = prisma,
  reference = new Date(),
): Promise<AccountantReport> {
  const range = getReportDateRange(filters, reference);
  const where = activeExpenseWhere(household.id, range, {
    categoryId: filters.categoryId,
    memberUserId: filters.memberUserId,
  });

  const [summary, categoryGroups, memberGroups, monthlyRows, expenses] = await Promise.all([
    db.expense.aggregate({
      where,
      _sum: { amount: true },
      _avg: { amount: true },
      _count: { _all: true },
    }),
    db.expense.groupBy({
      by: ["categoryId"],
      where,
      _sum: { amount: true },
      _count: { _all: true },
    }),
    db.expense.groupBy({
      by: ["paidByUserId"],
      where,
      _sum: { amount: true },
      _count: { _all: true },
    }),
    db.$queryRaw<Array<{ bucket: Date; total: string; count: bigint }>>`
      SELECT
        DATE_TRUNC('month', "invoice_date")::date AS "bucket",
        COALESCE(SUM("amount"), 0)::text         AS "total",
        COUNT(*)::bigint                          AS "count"
      FROM "expenses"
      WHERE "household_id" = CAST(${household.id} AS uuid)
        AND "deleted_at" IS NULL
        AND "invoice_date" >= ${range.from}
        AND "invoice_date" <= ${range.to}
        ${filters.categoryId ? Prisma.sql`AND "category_id" = CAST(${filters.categoryId} AS uuid)` : Prisma.empty}
        ${filters.memberUserId ? Prisma.sql`AND "paid_by_user_id" = CAST(${filters.memberUserId} AS uuid)` : Prisma.empty}
      GROUP BY "bucket"
      ORDER BY "bucket" ASC
    `,
    db.expense.findMany({
      where,
      include: {
        category: { select: { id: true, name: true } },
        user: { select: { id: true, name: true } },
        paidByUser: { select: { id: true, name: true } },
      },
      orderBy: [{ invoiceDate: "asc" }, { createdAt: "asc" }],
    }),
  ]);

  const categoryNames = new Map(
    expenses.map((e) => [e.categoryId, e.category.name]),
  );
  // Member breakdown is keyed by the paid-by member.
  const userNames = new Map(expenses.map((e) => [e.paidByUserId, e.paidByUser.name]));

  return {
    household,
    range,
    generatedAt: new Date(),
    filters: {
      period: filters.period,
      categoryId: filters.categoryId,
      memberUserId: filters.memberUserId,
    },
    totals: {
      total: Number(summary._sum.amount ?? 0),
      count: summary._count._all,
      average: Number(summary._avg.amount ?? 0),
    },
    categoryBreakdown: categoryGroups
      .map((row) => ({
        categoryId: row.categoryId,
        name: categoryNames.get(row.categoryId) ?? "Unknown category",
        total: Number(row._sum.amount ?? 0),
        count: row._count._all,
      }))
      .sort((l, r) => r.total - l.total),
    memberBreakdown: memberGroups
      .map((row) => ({
        userId: row.paidByUserId,
        name: userNames.get(row.paidByUserId) ?? "Unknown member",
        total: Number(row._sum.amount ?? 0),
        count: row._count._all,
      }))
      .sort((l, r) => r.total - l.total),
    monthlyTotals: monthlyRows.map((row) => ({
      month: row.bucket.toISOString().slice(0, 7),
      total: Number(row.total),
      count: Number(row.count),
    })),
    expenses: expenses.map((e) => ({
      id: e.id,
      invoiceNumber: e.invoiceNumber,
      invoiceDate: e.invoiceDate,
      amount: Number(e.amount),
      categoryId: e.categoryId,
      categoryName: e.category.name,
      userId: e.paidByUserId,
      userName: e.paidByUser.name,
      enteredByUserId: e.userId,
      enteredByUserName: e.user.name,
      filePath: e.filePath,
    })),
  };
}

export async function countAccountantReportExpenses(
  householdId: string,
  filters: ReportFilters,
  db: Pick<typeof prisma, "expense"> = prisma,
  reference = new Date(),
) {
  const range = getReportDateRange(filters, reference);
  return db.expense.count({
    where: activeExpenseWhere(householdId, range, {
      categoryId: filters.categoryId,
      memberUserId: filters.memberUserId,
    }),
  });
}

export async function getReportData(
  householdId: string,
  filters: ReportFilters,
  db: ReportingStore = prisma,
  reference = new Date(),
) {
  const range = getReportDateRange(filters, reference);
  const where = activeExpenseWhere(householdId, range, {
    categoryId: filters.categoryId,
    memberUserId: filters.memberUserId,
  });
  const [summary, categoryGroups, memberGroups, monthlyRows, total] = await Promise.all([
    db.expense.aggregate({
      where,
      _sum: { amount: true },
      _avg: { amount: true },
      _count: { _all: true },
    }),
    db.expense.groupBy({
      by: ["categoryId"],
      where,
      _sum: { amount: true },
      _count: { _all: true },
    }),
    db.expense.groupBy({
      by: ["paidByUserId"],
      where,
      _sum: { amount: true },
      _count: { _all: true },
    }),
    db.$queryRaw<Array<{ bucket: Date; total: string; count: bigint }>>`
      SELECT
        DATE_TRUNC('month', "invoice_date")::date AS "bucket",
        COALESCE(SUM("amount"), 0)::text         AS "total",
        COUNT(*)::bigint                          AS "count"
      FROM "expenses"
      WHERE "household_id" = CAST(${householdId} AS uuid)
        AND "deleted_at" IS NULL
        AND "invoice_date" >= ${range.from}
        AND "invoice_date" <= ${range.to}
        ${filters.categoryId ? Prisma.sql`AND "category_id" = CAST(${filters.categoryId} AS uuid)` : Prisma.empty}
        ${filters.memberUserId ? Prisma.sql`AND "paid_by_user_id" = CAST(${filters.memberUserId} AS uuid)` : Prisma.empty}
      GROUP BY "bucket"
      ORDER BY "bucket" ASC
    `,
    db.expense.count({ where }),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / filters.pageSize));
  const page = Math.min(filters.page, totalPages);
  const [expenses, categories, users] = await Promise.all([
    db.expense.findMany({
      where,
      include: {
        category: true,
        user: true,
        paidByUser: { select: { id: true, name: true } },
      },
      orderBy: [{ invoiceDate: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * filters.pageSize,
      take: filters.pageSize,
    }),
    db.category.findMany({
      where: {
        householdId,
        id: { in: categoryGroups.map((group) => group.categoryId) },
      },
      select: { id: true, name: true },
    }),
    db.user.findMany({
      where: { id: { in: memberGroups.map((group) => group.paidByUserId) } },
      select: { id: true, name: true },
    }),
  ]);
  const categoryNames = new Map(categories.map((category) => [category.id, category.name]));
  const userNames = new Map(users.map((user) => [user.id, user.name]));

  return {
    range,
    summary: {
      total: summary._sum.amount ?? null,
      average: summary._avg.amount ?? null,
      count: summary._count._all,
    },
    categories: categoryGroups
      .map((group) => ({
        categoryId: group.categoryId,
        name: categoryNames.get(group.categoryId) ?? "Unknown category",
        total: group._sum.amount ?? null,
        count: group._count._all,
      }))
      .sort((left, right) => Number(right.total ?? 0) - Number(left.total ?? 0)),
    members: memberGroups
      .map((group) => ({
        userId: group.paidByUserId,
        name: userNames.get(group.paidByUserId) ?? "Unknown member",
        total: group._sum.amount ?? null,
        count: group._count._all,
      }))
      .sort((left, right) => Number(right.total ?? 0) - Number(left.total ?? 0)),
    monthlyTotals: monthlyRows.map((row) => ({
      month: row.bucket.toISOString().slice(0, 7),
      total: Number(row.total),
      count: Number(row.count),
    })),
    expenses,
    pagination: { page, pageSize: filters.pageSize, total, totalPages },
  };
}
