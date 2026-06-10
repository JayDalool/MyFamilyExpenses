import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/ui";
import { canCreateExpense } from "@/lib/auth/permissions";
import { requireHouseholdMember } from "@/lib/auth/session";
import { getDashboardAnalytics, getDashboardSummary } from "@/lib/reporting";
import { formatCurrency } from "@/lib/utils";

export const dynamic = "force-dynamic";

function expenseCountLabel(count: number) {
  return `${count} expense${count === 1 ? "" : "s"}`;
}

function BreakdownBars({
  rows,
  empty,
}: {
  rows: Array<{ name: string; total: number; count: number }>;
  empty: string;
}) {
  const max = Math.max(...rows.map((row) => row.total), 1);
  if (rows.length === 0) return <p className="mt-4 text-sm text-slate-500">{empty}</p>;

  return (
    <div className="mt-4 space-y-4">
      {rows.slice(0, 6).map((row) => (
        <div key={row.name}>
          <div className="mb-1 flex items-center justify-between gap-3 text-sm">
            <span className="truncate font-medium text-slate-700">{row.name}</span>
            <span className="whitespace-nowrap font-semibold text-slate-900">
              {formatCurrency(row.total)}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-brand-600"
              style={{ width: `${Math.max((row.total / max) * 100, 2)}%` }}
            />
          </div>
          <p className="mt-1 text-xs text-slate-400">{expenseCountLabel(row.count)}</p>
        </div>
      ))}
    </div>
  );
}

export default async function DashboardPage() {
  const auth = await requireHouseholdMember();
  const { user, householdId } = auth;
  const [summary, analytics] = await Promise.all([
    getDashboardSummary(householdId),
    getDashboardAnalytics(householdId),
  ]);
  const maxMonthly = Math.max(...analytics.monthlyTrend.map((row) => row.total), 1);
  const maxDaily = Math.max(...analytics.dailyTrendThisMonth.map((row) => row.total), 1);

  return (
    <AppShell auth={auth}>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Hi, {user.name.split(" ")[0]}</h1>
            <p className="text-sm text-slate-500">
              Spending analytics for {auth.householdName}, based on invoice date.
            </p>
          </div>
          {canCreateExpense(auth) ? (
            <Link
              href="/expenses"
              className="inline-flex min-h-10 items-center justify-center rounded-lg border border-brand-600 bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700"
            >
              Add expense
            </Link>
          ) : null}
        </div>

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Card>
            <p className="text-sm font-medium text-slate-500">This month</p>
            <p className="mt-2 text-2xl font-bold text-slate-900">{formatCurrency(analytics.thisMonth.total)}</p>
            <p className="mt-1 text-xs text-slate-500">{expenseCountLabel(analytics.thisMonth.count)}</p>
          </Card>
          <Card>
            <p className="text-sm font-medium text-slate-500">Last month</p>
            <p className="mt-2 text-2xl font-bold text-slate-900">{formatCurrency(analytics.lastMonth.total)}</p>
            <p className="mt-1 text-xs text-slate-500">{expenseCountLabel(analytics.lastMonth.count)}</p>
          </Card>
          <Card>
            <p className="text-sm font-medium text-slate-500">This year</p>
            <p className="mt-2 text-2xl font-bold text-slate-900">{formatCurrency(analytics.thisYear.total)}</p>
            <p className="mt-1 text-xs text-slate-500">{expenseCountLabel(analytics.thisYear.count)}</p>
          </Card>
          <Card>
            <p className="text-sm font-medium text-slate-500">Average active month</p>
            <p className="mt-2 text-2xl font-bold text-slate-900">{formatCurrency(analytics.averageMonthly.total)}</p>
            <p className="mt-1 text-xs text-slate-500">Across {analytics.averageMonthly.months} months with spending</p>
          </Card>
        </section>

        <section className="grid gap-4 sm:grid-cols-3">
          <Card>
            <p className="text-sm font-medium text-slate-500">Highest category this month</p>
            <p className="mt-2 font-semibold text-slate-900">
              {analytics.highestCategoryThisMonth?.name ?? "No spending"}
            </p>
            <p className="mt-1 text-sm text-slate-500">
              {formatCurrency(analytics.highestCategoryThisMonth?.total ?? 0)}
            </p>
          </Card>
          <Card>
            <p className="text-sm font-medium text-slate-500">Top spender this month</p>
            <p className="mt-2 font-semibold text-slate-900">
              {analytics.topSpenderThisMonth?.name ?? "No spending"}
            </p>
            <p className="mt-1 text-sm text-slate-500">
              {formatCurrency(analytics.topSpenderThisMonth?.total ?? 0)}
            </p>
          </Card>
          <Card>
            <p className="text-sm font-medium text-slate-500">Receipt and expense count</p>
            <p className="mt-2 text-2xl font-bold text-slate-900">{analytics.expenseCount.allTime}</p>
            <p className="mt-1 text-xs text-slate-500">{analytics.expenseCount.thisMonth} this month</p>
          </Card>
        </section>

        <Card>
          <div className="flex items-end justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Monthly spending trend</h2>
              <p className="text-sm text-slate-500">Last 12 calendar months</p>
            </div>
            <Link className="text-sm font-medium text-brand-700" href="/reports?period=year">Open reports</Link>
          </div>
          <div className="mt-5 grid h-48 grid-cols-12 items-end gap-1 sm:gap-2">
            {analytics.monthlyTrend.map((month) => (
              <div className="flex min-w-0 flex-col items-center gap-2" key={month.month}>
                <div className="flex h-36 w-full items-end overflow-hidden rounded bg-slate-100" title={`${month.month}: ${formatCurrency(month.total)}`}>
                  <div
                    className="w-full rounded bg-brand-600"
                    style={{ height: `${month.total === 0 ? 0 : Math.max((month.total / maxMonthly) * 100, 4)}%` }}
                  />
                </div>
                <span className="text-[10px] text-slate-500">{month.month.slice(5)}</span>
              </div>
            ))}
          </div>
        </Card>

        <section className="grid gap-6 lg:grid-cols-2">
          <Card>
            <h2 className="text-lg font-semibold text-slate-900">Category spending this year</h2>
            <BreakdownBars rows={analytics.categoryBreakdownThisYear} empty="No category spending this year." />
          </Card>
          <Card>
            <h2 className="text-lg font-semibold text-slate-900">Member spending this year</h2>
            <BreakdownBars rows={analytics.memberBreakdownThisYear} empty="No member spending this year." />
          </Card>
        </section>

        <Card>
          <h2 className="text-lg font-semibold text-slate-900">Daily spending this month</h2>
          <div className="mt-5 grid h-32 grid-cols-[repeat(auto-fit,minmax(8px,1fr))] items-end gap-1">
            {analytics.dailyTrendThisMonth.map((day) => (
              <div
                className="w-full rounded-t bg-emerald-500"
                key={day.day}
                style={{ height: `${day.total === 0 ? 2 : Math.max((day.total / maxDaily) * 100, 5)}%` }}
                title={`${day.day}: ${formatCurrency(day.total)}`}
              />
            ))}
          </div>
          <div className="mt-2 flex justify-between text-xs text-slate-400">
            <span>{analytics.dailyTrendThisMonth[0]?.day ?? ""}</span>
            <span>{analytics.dailyTrendThisMonth.at(-1)?.day ?? ""}</span>
          </div>
        </Card>

        <Card>
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Recent expenses</h2>
              <p className="text-sm text-slate-500">Latest active invoices in this household.</p>
            </div>
            <Link className="text-sm font-medium text-brand-700" href="/expenses">View all</Link>
          </div>
          {summary.recentExpenses.length === 0 ? (
            <p className="py-6 text-sm text-slate-500">No expenses yet.</p>
          ) : (
            <div className="divide-y divide-slate-200">
              {summary.recentExpenses.map((expense) => (
                <div className="flex items-center justify-between gap-4 py-3" key={expense.id}>
                  <div className="min-w-0">
                    <Link className="block truncate font-medium text-slate-900 hover:text-brand-700" href={`/expenses/${expense.id}`}>
                      {expense.invoiceNumber}
                    </Link>
                    <p className="truncate text-xs text-slate-500">
                      {expense.category.name} | {expense.invoiceDate.toISOString().slice(0, 10)} | {expense.user.name}
                    </p>
                  </div>
                  <p className="whitespace-nowrap font-semibold text-slate-900">{formatCurrency(expense.amount.toString())}</p>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </AppShell>
  );
}
