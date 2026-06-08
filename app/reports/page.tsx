import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { requireHouseholdMember } from "@/lib/auth/session";
import {
  getReportData,
  normalizeReportFilters,
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
  { value: "week", label: "Weekly" },
  { value: "month", label: "Monthly" },
  { value: "year", label: "Yearly" },
  { value: "custom", label: "Custom range" },
];

function buildReportsHref(filters: ReportFilters, page: number) {
  const params = new URLSearchParams({ period: filters.period });
  if (filters.fromDate) params.set("fromDate", filters.fromDate);
  if (filters.toDate) params.set("toDate", filters.toDate);
  if (filters.pageSize !== 10) params.set("pageSize", String(filters.pageSize));
  if (page > 1) params.set("page", String(page));
  return `/reports?${params.toString()}`;
}

export default async function ReportsPage({ searchParams }: ReportsPageProps) {
  const auth = await requireHouseholdMember();
  const filters = normalizeReportFilters((await searchParams) ?? {});
  const report = await getReportData(auth.householdId, filters);
  const from = report.range.from.toISOString().slice(0, 10);
  const to = report.range.to.toISOString().slice(0, 10);

  return (
    <AppShell auth={auth}>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Reports</h1>
          <p className="text-sm text-slate-500">
            {auth.householdName} | Invoice dates from {from} to {to}
          </p>
        </div>

        <form action="/reports" className="grid gap-4 rounded-3xl bg-white p-6 shadow-soft md:grid-cols-4">
          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700" htmlFor="period">
              Report period
            </label>
            <select
              className="w-full rounded-xl border border-slate-300 px-3 py-2"
              defaultValue={filters.period}
              id="period"
              name="period"
            >
              {PERIODS.map((period) => (
                <option key={period.value} value={period.value}>
                  {period.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700" htmlFor="fromDate">
              Custom from
            </label>
            <input className="w-full rounded-xl border border-slate-300 px-3 py-2" defaultValue={filters.fromDate} id="fromDate" name="fromDate" type="date" />
          </div>
          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700" htmlFor="toDate">
              Custom to
            </label>
            <input className="w-full rounded-xl border border-slate-300 px-3 py-2" defaultValue={filters.toDate} id="toDate" name="toDate" type="date" />
          </div>
          <div className="flex items-end">
            <button className="w-full rounded-xl bg-brand-600 px-4 py-2 font-semibold text-white" type="submit">
              Run report
            </button>
          </div>
        </form>

        <section className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-3xl bg-white p-6 shadow-soft">
            <p className="text-sm font-medium text-slate-500">Total amount</p>
            <p className="mt-2 text-3xl font-bold text-slate-900">{formatCurrency(report.summary.total?.toString() ?? 0)}</p>
          </div>
          <div className="rounded-3xl bg-white p-6 shadow-soft">
            <p className="text-sm font-medium text-slate-500">Expense count</p>
            <p className="mt-2 text-3xl font-bold text-slate-900">{report.summary.count}</p>
          </div>
          <div className="rounded-3xl bg-white p-6 shadow-soft">
            <p className="text-sm font-medium text-slate-500">Average expense</p>
            <p className="mt-2 text-3xl font-bold text-slate-900">{formatCurrency(report.summary.average?.toString() ?? 0)}</p>
          </div>
        </section>

        <section className="rounded-3xl bg-white p-6 shadow-soft">
          <h2 className="text-lg font-semibold text-slate-900">Category breakdown</h2>
          <div className="mt-4 divide-y divide-slate-200">
            {report.categories.length === 0 ? (
              <p className="py-4 text-sm text-slate-500">No expenses in this period.</p>
            ) : report.categories.map((category) => (
              <div className="flex items-center justify-between gap-4 py-3" key={category.categoryId}>
                <div>
                  <p className="font-medium text-slate-900">{category.name}</p>
                  <p className="text-sm text-slate-500">{category.count} expense{category.count === 1 ? "" : "s"}</p>
                </div>
                <p className="font-semibold text-slate-900">{formatCurrency(category.total?.toString() ?? 0)}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-3xl bg-white p-6 shadow-soft">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Invoices and receipts</h2>
            <p className="text-sm text-slate-500">
              Showing {report.expenses.length} of {report.pagination.total} matching expenses.
            </p>
          </div>
          <div className="mt-4 divide-y divide-slate-200">
            {report.expenses.length === 0 ? (
              <p className="py-4 text-sm text-slate-500">No receipts in this period.</p>
            ) : report.expenses.map((expense) => (
              <div className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between" key={expense.id}>
                <div>
                  <Link className="font-medium text-slate-900 hover:text-brand-700" href={`/expenses/${expense.id}`}>
                    {expense.invoiceNumber}
                  </Link>
                  <p className="text-sm text-slate-500">{expense.category.name} | {expense.invoiceDate.toISOString().slice(0, 10)}</p>
                </div>
                <div className="flex items-center gap-3">
                  <p className="font-semibold text-slate-900">{formatCurrency(expense.amount.toString())}</p>
                  <a className="text-sm font-medium text-brand-700" href={`/api/expenses/${expense.id}/file`} target="_blank" rel="noreferrer">Preview</a>
                  <a className="text-sm font-medium text-brand-700" href={`/api/expenses/${expense.id}/file?download=1`}>Download</a>
                </div>
              </div>
            ))}
          </div>
          {report.pagination.totalPages > 1 ? (
            <div className="mt-4 flex items-center justify-between border-t border-slate-200 pt-4">
              <Link aria-disabled={report.pagination.page <= 1} className={report.pagination.page <= 1 ? "pointer-events-none text-slate-300" : "font-medium text-brand-700"} href={buildReportsHref(filters, report.pagination.page - 1)}>Previous</Link>
              <p className="text-sm text-slate-500">Page {report.pagination.page} of {report.pagination.totalPages}</p>
              <Link aria-disabled={report.pagination.page >= report.pagination.totalPages} className={report.pagination.page >= report.pagination.totalPages ? "pointer-events-none text-slate-300" : "font-medium text-brand-700"} href={buildReportsHref(filters, report.pagination.page + 1)}>Next</Link>
            </div>
          ) : null}
        </section>
      </div>
    </AppShell>
  );
}
