import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";

type RawSearchParams = Record<string, string | string[] | undefined>;
type ReportingStore = Pick<typeof prisma, "category" | "expense">;

export type ReportPeriod = "today" | "week" | "month" | "year" | "custom";

export type ReportFilters = {
  period: ReportPeriod;
  fromDate?: string;
  toDate?: string;
  page: number;
  pageSize: number;
};

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

export function normalizeReportFilters(searchParams: RawSearchParams = {}): ReportFilters {
  const requestedPeriod = single(searchParams.period);
  const period: ReportPeriod = ["today", "week", "month", "year", "custom"].includes(
    requestedPeriod ?? "",
  )
    ? (requestedPeriod as ReportPeriod)
    : "month";
  const requestedFromDate = single(searchParams.fromDate);
  const requestedToDate = single(searchParams.toDate);
  const fromDate = DATE_PATTERN.test(requestedFromDate ?? "") ? requestedFromDate : undefined;
  const toDate = DATE_PATTERN.test(requestedToDate ?? "") ? requestedToDate : undefined;

  const normalizedPeriod =
    period === "custom" && (!fromDate || !toDate || fromDate > toDate) ? "month" : period;

  return {
    period: normalizedPeriod,
    fromDate,
    toDate,
    page: positiveInteger(single(searchParams.page), 1, 9999),
    pageSize: positiveInteger(
      single(searchParams.pageSize),
      DEFAULT_REPORT_PAGE_SIZE,
      MAX_REPORT_PAGE_SIZE,
    ),
  };
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

function parseDateOnly(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return dateOnly(year!, month!, day!);
}

export function getReportDateRange(
  filters: Pick<ReportFilters, "period" | "fromDate" | "toDate">,
  reference = new Date(),
  timeZone = process.env.APP_TIME_ZONE ?? "UTC",
) {
  const { year, month, day } = getDateParts(reference, timeZone);
  const today = dateOnly(year, month, day);

  if (filters.period === "custom" && filters.fromDate && filters.toDate) {
    const from = parseDateOnly(filters.fromDate);
    const to = parseDateOnly(filters.toDate);
    if (from <= to) return { from, to };
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
): Prisma.ExpenseWhereInput {
  return {
    householdId,
    deletedAt: null,
    ...(range ? { invoiceDate: { gte: range.from, lte: range.to } } : {}),
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
      include: { category: true, user: true },
      orderBy: [{ invoiceDate: "desc" }, { createdAt: "desc" }],
      take: 6,
    }),
  ]);

  return { today, month, allTime, recentExpenses };
}

export async function getReportData(
  householdId: string,
  filters: ReportFilters,
  db: ReportingStore = prisma,
  reference = new Date(),
) {
  const range = getReportDateRange(filters, reference);
  const where = activeExpenseWhere(householdId, range);
  const [summary, groups, total] = await Promise.all([
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
    db.expense.count({ where }),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / filters.pageSize));
  const page = Math.min(filters.page, totalPages);
  const [expenses, categories] = await Promise.all([
    db.expense.findMany({
      where,
      include: { category: true, user: true },
      orderBy: [{ invoiceDate: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * filters.pageSize,
      take: filters.pageSize,
    }),
    db.category.findMany({
      where: {
        householdId,
        id: { in: groups.map((group) => group.categoryId) },
      },
      select: { id: true, name: true },
    }),
  ]);
  const categoryNames = new Map(categories.map((category) => [category.id, category.name]));

  return {
    range,
    summary: {
      total: summary._sum.amount ?? null,
      average: summary._avg.amount ?? null,
      count: summary._count._all,
    },
    categories: groups
      .map((group) => ({
        categoryId: group.categoryId,
        name: categoryNames.get(group.categoryId) ?? "Unknown category",
        total: group._sum.amount ?? null,
        count: group._count._all,
      }))
      .sort((left, right) => Number(right.total ?? 0) - Number(left.total ?? 0)),
    expenses,
    pagination: { page, pageSize: filters.pageSize, total, totalPages },
  };
}
