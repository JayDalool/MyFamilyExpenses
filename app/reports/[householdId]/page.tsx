import Link from "next/link";
import { AccountantShell } from "@/components/accountant-shell";
import { AppShell } from "@/components/app-shell";
import { ReportFilters as ReportFiltersForm } from "@/components/report-filters";
import { Alert, ButtonLink, Card, Pagination, Table } from "@/components/ui";
import { notFound } from "next/navigation";
import { canViewReports } from "@/lib/auth/permissions";
import { getUserHousehold, requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import {
  getReportData,
  getReportCurrencies,
  MIXED_REPORT_CURRENCIES_MESSAGE,
  parseReportFilters,
  type ReportFilters,
} from "@/lib/reporting";
import { formatCents } from "@/lib/money";
import { workspaceReportsHref } from "@/lib/report-links";

export const dynamic = "force-dynamic";

type ReportsPageProps = {
  params: Promise<{ householdId: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function reportParams(filters: ReportFilters) {
  const params = new URLSearchParams({ period: filters.period });
  if (filters.fromDate) params.set("fromDate", filters.fromDate);
  if (filters.toDate) params.set("toDate", filters.toDate);
  if (filters.categoryId) params.set("categoryId", filters.categoryId);
  if (filters.memberUserId) params.set("memberUserId", filters.memberUserId);
  if (filters.vendor) params.set("vendor", filters.vendor);
  if (filters.currency) params.set("currency", filters.currency);
  if (filters.sort) params.set("sort", filters.sort);
  if (filters.pageSize !== 10) params.set("pageSize", String(filters.pageSize));
  return params;
}

function buildReportsHref(path: string, filters: ReportFilters, page: number) {
  const params = reportParams(filters);
  if (page > 1) params.set("page", String(page));
  return `${path}?${params.toString()}`;
}

function buildExportHref(path: string, filters: ReportFilters, format: "pdf" | "csv" | "xlsx" | "zip") {
  const params = reportParams(filters);
  params.set("format", format);
  return `/api${path}/export?${params.toString()}`;
}

export default async function ReportsPage({ params, searchParams }: ReportsPageProps) {
  const user = await requireUser();
  const { householdId } = await params;
  const auth = await getUserHousehold(user, householdId);
  if (!auth || !canViewReports(auth)) notFound();
  const path = workspaceReportsHref(householdId);
  const parsedFilters = parseReportFilters((await searchParams) ?? {});
  const filters = parsedFilters.filters;
  const reference = new Date();
  const [currencies, categories, memberships] = await Promise.all([
    parsedFilters.ok ? getReportCurrencies(householdId, filters, undefined, reference) : Promise.resolve([]),
    prisma.category.findMany({
      where: { householdId: auth.householdId },
      orderBy: [{ status: "asc" }, { name: "asc" }],
      select: { id: true, name: true, status: true },
    }),
    prisma.membership.findMany({
      where: { householdId: auth.householdId },
      include: { user: { select: { id: true, name: true } } },
      orderBy: { createdAt: "asc" },
    }),
  ]);
  const needsCurrency = !filters.currency && currencies.length > 1;
  const currency = filters.currency ?? currencies[0] ?? "CAD";
  const report = parsedFilters.ok && !needsCurrency
    ? await getReportData(householdId, { ...filters, currency }, undefined, reference)
    : null;
  const exportFilters = { ...filters, currency };
  const from = report?.range.from.toISOString().slice(0, 10);
  const to = report?.range.to.toISOString().slice(0, 10);
  const maxMonthly = Math.max(...(report?.monthlyTotals.map((row) => row.totalCents) ?? []), 1);

  const content = (
      <div className="space-y-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Reports</h1>
            <p className="text-sm text-slate-500">
              {report
                ? `${auth.householdName} | Invoice dates from ${from} to ${to} · ${currency}`
                : auth.householdName}
            </p>
          </div>
          {report ? (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              <ButtonLink href={buildExportHref(path, exportFilters, "pdf")} variant="secondary">PDF</ButtonLink>
              <ButtonLink href={buildExportHref(path, exportFilters, "csv")} variant="secondary">CSV</ButtonLink>
              <ButtonLink href={buildExportHref(path, exportFilters, "xlsx")} variant="secondary">XLSX</ButtonLink>
              {/* Receipt files plus the index and summary, for the accountant. */}
              <ButtonLink
                href={buildExportHref(path, exportFilters, "zip")}
                className="col-span-3 sm:col-span-1"
              >
                ZIP with receipts
              </ButtonLink>
            </div>
          ) : null}
        </div>

        <Card>
          <ReportFiltersForm
            key={JSON.stringify(filters)}
            action={path}
            filters={filters}
            categories={categories}
            currencies={currencies}
            members={memberships.map(({ user, removedAt }) => ({ ...user, removed: Boolean(removedAt) }))}
          />
        </Card>

        {!parsedFilters.ok ? <Alert variant="danger">{parsedFilters.error}</Alert> : null}
        {needsCurrency && <Alert variant="info">{MIXED_REPORT_CURRENCIES_MESSAGE}</Alert>}

        {report ? (
          <>
          <section className="grid gap-4 sm:grid-cols-3">
          <Card>
            <p className="text-sm font-medium text-slate-500">Total spending</p>
            <p className="mt-2 text-2xl font-bold text-slate-900">
              {formatCents(report.summary.totalCents ?? 0, currency)}
            </p>
          </Card>
          <Card>
            <p className="text-sm font-medium text-slate-500">Expense count</p>
            <p className="mt-2 text-2xl font-bold text-slate-900">{report.summary.count}</p>
          </Card>
          <Card>
            <p className="text-sm font-medium text-slate-500">Average expense</p>
            <p className="mt-2 text-2xl font-bold text-slate-900">
              {formatCents(report.summary.averageCents ?? 0, currency)}
            </p>
          </Card>
        </section>

        <section className="grid gap-6 lg:grid-cols-2">
          <Card>
            <h2 className="text-lg font-semibold text-slate-900">Category breakdown</h2>
            <div className="mt-3 divide-y divide-slate-200">
              {report.categories.length === 0 ? (
                <p className="py-4 text-sm text-slate-500">No expenses in this period.</p>
              ) : report.categories.map((category) => (
                <div className="flex items-center justify-between gap-4 py-3" key={category.categoryId}>
                  <div>
                    <p className="font-medium text-slate-900">{category.name}</p>
                    <p className="text-xs text-slate-500">
                      {category.count} expense{category.count === 1 ? "" : "s"}
                    </p>
                  </div>
                  <p className="font-semibold text-slate-900">
                    {formatCents(category.totalCents ?? 0, currency)}
                  </p>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <h2 className="text-lg font-semibold text-slate-900">Member breakdown (paid by)</h2>
            <div className="mt-3 divide-y divide-slate-200">
              {report.members.length === 0 ? (
                <p className="py-4 text-sm text-slate-500">No member spending in this period.</p>
              ) : report.members.map((member) => (
                <div className="flex items-center justify-between gap-4 py-3" key={member.userId}>
                  <div>
                    <p className="font-medium text-slate-900">{member.name}</p>
                    <p className="text-xs text-slate-500">
                      {member.count} expense{member.count === 1 ? "" : "s"}
                    </p>
                  </div>
                  <p className="font-semibold text-slate-900">
                    {formatCents(member.totalCents ?? 0, currency)}
                  </p>
                </div>
              ))}
            </div>
          </Card>
        </section>

        <Card>
          <h2 className="text-lg font-semibold text-slate-900">Monthly totals</h2>
          <div className="mt-4 space-y-3">
            {report.monthlyTotals.length === 0 ? (
              <p className="text-sm text-slate-500">No monthly totals in this period.</p>
            ) : report.monthlyTotals.map((month) => (
              <div className="grid grid-cols-[5rem_1fr_auto] items-center gap-3" key={month.month}>
                <p className="text-sm font-medium text-slate-700">{month.month}</p>
                <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-brand-600"
                    style={{ width: `${Math.max((month.totalCents / maxMonthly) * 100, 2)}%` }}
                  />
                </div>
                <p className="text-sm font-semibold text-slate-900">{formatCents(month.totalCents, currency)}</p>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Expense register</h2>
            <p className="text-sm text-slate-500">
              Showing {report.expenses.length} of {report.pagination.total} matching expenses.
            </p>
          </div>
          <Table className="mt-4">
            <thead>
              <tr className="border-b border-slate-200 text-xs uppercase text-slate-500">
                <th className="px-2 py-3">Invoice</th>
                <th className="px-2 py-3">Date</th>
                <th className="px-2 py-3">Vendor</th>
                <th className="px-2 py-3">Category</th>
                <th className="px-2 py-3">Paid by</th>
                <th className="px-2 py-3">Entered by</th>
                <th className="px-2 py-3 text-right">Amount</th>
                <th className="px-2 py-3">Receipt</th>
              </tr>
            </thead>
            <tbody>
              {report.expenses.map((expense) => (
                <tr className="border-b border-slate-100 last:border-0" key={expense.id}>
                  <td className="whitespace-nowrap px-2 py-3">
                    <Link className="font-medium text-brand-700" href={`/expenses/${expense.id}?workspace=${householdId}`}>
                      {expense.invoiceNumber}
                    </Link>
                  </td>
                  <td className="whitespace-nowrap px-2 py-3 text-slate-600">
                    {expense.invoiceDate.toISOString().slice(0, 10)}
                  </td>
                  <td className="px-2 py-3 text-slate-600">{expense.vendor ?? "—"}</td>
                  <td className="px-2 py-3 text-slate-600">{expense.category.name}</td>
                  <td className="px-2 py-3 text-slate-600">{expense.paidByUser.name}</td>
                  <td className="px-2 py-3 text-slate-500">{expense.user.name}</td>
                  <td className="whitespace-nowrap px-2 py-3 text-right font-semibold">
                    {formatCents(expense.amountCents, expense.currency)}
                  </td>
                  <td className="whitespace-nowrap px-2 py-3">
                    <a className="font-medium text-brand-700" href={`/api/expenses/${expense.id}/file?workspace=${householdId}`} target="_blank" rel="noreferrer">Preview</a>
                    <span className="px-1 text-slate-300">|</span>
                    <a className="font-medium text-brand-700" href={`/api/expenses/${expense.id}/file?workspace=${householdId}&download=1`}>Download</a>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
          {report.expenses.length === 0 ? (
            <p className="py-6 text-sm text-slate-500">No expenses in this period.</p>
          ) : null}
          {report.pagination.totalPages > 1 ? (
            <Pagination
              currentPage={report.pagination.page}
              totalPages={report.pagination.totalPages}
              previousHref={report.pagination.page > 1 ? buildReportsHref(path, filters, report.pagination.page - 1) : undefined}
              nextHref={report.pagination.page < report.pagination.totalPages ? buildReportsHref(path, filters, report.pagination.page + 1) : undefined}
            />
          ) : null}
        </Card>
          </>
        ) : null}
      </div>
  );
  return auth.householdRole === "ACCOUNTANT"
    ? <AccountantShell>{content}</AccountantShell>
    : <AppShell auth={auth}>{content}</AppShell>;
}
