import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { Alert, Button, ButtonLink, Card, Input, Pagination, Select, Table } from "@/components/ui";
import { requireHouseholdMember } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import {
  getReportData,
  parseReportFilters,
  type ReportFilters,
  type ReportPeriod,
} from "@/lib/reporting";
import { formatCurrency } from "@/lib/utils";

export const dynamic = "force-dynamic";

type ReportsPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

const PERIODS: Array<{ value: ReportPeriod; label: string }> = [
  { value: "today", label: "Today" },
  { value: "week", label: "This week" },
  { value: "month", label: "This month" },
  { value: "year", label: "This year" },
  { value: "custom", label: "Custom range" },
];

function reportParams(filters: ReportFilters) {
  const params = new URLSearchParams({ period: filters.period });
  if (filters.fromDate) params.set("fromDate", filters.fromDate);
  if (filters.toDate) params.set("toDate", filters.toDate);
  if (filters.categoryId) params.set("categoryId", filters.categoryId);
  if (filters.memberUserId) params.set("memberUserId", filters.memberUserId);
  if (filters.pageSize !== 10) params.set("pageSize", String(filters.pageSize));
  return params;
}

function buildReportsHref(filters: ReportFilters, page: number) {
  const params = reportParams(filters);
  if (page > 1) params.set("page", String(page));
  return `/reports?${params.toString()}`;
}

function buildExportHref(filters: ReportFilters, format: "pdf" | "csv" | "xlsx") {
  const params = reportParams(filters);
  params.set("format", format);
  return `/api/reports/export?${params.toString()}`;
}

export default async function ReportsPage({ searchParams }: ReportsPageProps) {
  const auth = await requireHouseholdMember();
  const parsedFilters = parseReportFilters((await searchParams) ?? {});
  const filters = parsedFilters.filters;
  const [report, categories, memberships] = await Promise.all([
    parsedFilters.ok ? getReportData(auth.householdId, filters) : Promise.resolve(null),
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
  const from = report?.range.from.toISOString().slice(0, 10);
  const to = report?.range.to.toISOString().slice(0, 10);
  const maxMonthly = Math.max(...(report?.monthlyTotals.map((row) => row.total) ?? []), 1);

  return (
    <AppShell auth={auth}>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Reports</h1>
            <p className="text-sm text-slate-500">
              {report
                ? `${auth.householdName} | Invoice dates from ${from} to ${to}`
                : `${auth.householdName} | Choose a valid custom date range`}
            </p>
          </div>
          {parsedFilters.ok ? (
            <div className="grid grid-cols-3 gap-2">
              <ButtonLink href={buildExportHref(filters, "pdf")} variant="secondary">PDF</ButtonLink>
              <ButtonLink href={buildExportHref(filters, "csv")} variant="secondary">CSV</ButtonLink>
              <ButtonLink href={buildExportHref(filters, "xlsx")} variant="secondary">XLSX</ButtonLink>
            </div>
          ) : null}
        </div>

        <Card>
          <form
            action="/reports"
            className={`grid gap-4 md:grid-cols-2 ${filters.period === "custom" ? "xl:grid-cols-5" : "xl:grid-cols-3"}`}
          >
            <label className="text-sm font-medium text-slate-700">
              Report period
              <Select className="mt-2" defaultValue={filters.period} name="period">
                {PERIODS.map((period) => (
                  <option key={period.value} value={period.value}>{period.label}</option>
                ))}
              </Select>
            </label>
            {filters.period === "custom" ? (
              <>
                <label className="text-sm font-medium text-slate-700">
                  From
                  <Input className="mt-2" defaultValue={filters.fromDate ?? ""} name="fromDate" type="date" />
                </label>
                <label className="text-sm font-medium text-slate-700">
                  To
                  <Input className="mt-2" defaultValue={filters.toDate ?? ""} name="toDate" type="date" />
                </label>
              </>
            ) : null}
            <label className="text-sm font-medium text-slate-700">
              Category
              <Select className="mt-2" defaultValue={filters.categoryId ?? ""} name="categoryId">
                <option value="">All categories</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}{category.status === "DISABLED" ? " (disabled)" : ""}
                  </option>
                ))}
              </Select>
            </label>
            <label className="text-sm font-medium text-slate-700">
              Household member
              <Select className="mt-2" defaultValue={filters.memberUserId ?? ""} name="memberUserId">
                <option value="">All members</option>
                {memberships.map((membership) => (
                  <option key={membership.userId} value={membership.userId}>
                    {membership.user.name}{membership.removedAt ? " (removed)" : ""}
                  </option>
                ))}
              </Select>
            </label>
            <div className="md:col-span-2 xl:col-span-5">
              <Button type="submit">Run report</Button>
            </div>
          </form>
        </Card>

        {!parsedFilters.ok ? <Alert variant="danger">{parsedFilters.error}</Alert> : null}

        {report ? (
          <>
          <section className="grid gap-4 sm:grid-cols-3">
          <Card>
            <p className="text-sm font-medium text-slate-500">Total spending</p>
            <p className="mt-2 text-2xl font-bold text-slate-900">
              {formatCurrency(report.summary.total?.toString() ?? 0)}
            </p>
          </Card>
          <Card>
            <p className="text-sm font-medium text-slate-500">Expense count</p>
            <p className="mt-2 text-2xl font-bold text-slate-900">{report.summary.count}</p>
          </Card>
          <Card>
            <p className="text-sm font-medium text-slate-500">Average expense</p>
            <p className="mt-2 text-2xl font-bold text-slate-900">
              {formatCurrency(report.summary.average?.toString() ?? 0)}
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
                    {formatCurrency(category.total?.toString() ?? 0)}
                  </p>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <h2 className="text-lg font-semibold text-slate-900">Member breakdown</h2>
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
                    {formatCurrency(member.total?.toString() ?? 0)}
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
                    style={{ width: `${Math.max((month.total / maxMonthly) * 100, 2)}%` }}
                  />
                </div>
                <p className="text-sm font-semibold text-slate-900">{formatCurrency(month.total)}</p>
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
                <th className="px-2 py-3">Category</th>
                <th className="px-2 py-3">Member</th>
                <th className="px-2 py-3 text-right">Amount</th>
                <th className="px-2 py-3">Receipt</th>
              </tr>
            </thead>
            <tbody>
              {report.expenses.map((expense) => (
                <tr className="border-b border-slate-100 last:border-0" key={expense.id}>
                  <td className="whitespace-nowrap px-2 py-3">
                    <Link className="font-medium text-brand-700" href={`/expenses/${expense.id}`}>
                      {expense.invoiceNumber}
                    </Link>
                  </td>
                  <td className="whitespace-nowrap px-2 py-3 text-slate-600">
                    {expense.invoiceDate.toISOString().slice(0, 10)}
                  </td>
                  <td className="px-2 py-3 text-slate-600">{expense.category.name}</td>
                  <td className="px-2 py-3 text-slate-600">{expense.user.name}</td>
                  <td className="whitespace-nowrap px-2 py-3 text-right font-semibold">
                    {formatCurrency(expense.amount.toString())}
                  </td>
                  <td className="whitespace-nowrap px-2 py-3">
                    <a className="font-medium text-brand-700" href={`/api/expenses/${expense.id}/file`} target="_blank" rel="noreferrer">Preview</a>
                    <span className="px-1 text-slate-300">|</span>
                    <a className="font-medium text-brand-700" href={`/api/expenses/${expense.id}/file?download=1`}>Download</a>
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
              previousHref={report.pagination.page > 1 ? buildReportsHref(filters, report.pagination.page - 1) : undefined}
              nextHref={report.pagination.page < report.pagination.totalPages ? buildReportsHref(filters, report.pagination.page + 1) : undefined}
            />
          ) : null}
        </Card>
          </>
        ) : null}
      </div>
    </AppShell>
  );
}
