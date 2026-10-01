import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { ButtonLink, Card } from "@/components/ui";
import { canCreateExpense } from "@/lib/auth/permissions";
import { requireHouseholdMember } from "@/lib/auth/session";
import { getDashboardAnalytics, getDashboardSummary } from "@/lib/reporting";
import { formatCurrency } from "@/lib/utils";

export const dynamic = "force-dynamic";

function monthLabel(timeZone = process.env.APP_TIME_ZONE ?? "UTC") {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone,
  }).format(new Date());
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card className="p-6">
      <p className="text-sm font-medium text-slate-500">{label}</p>
      <p className="mt-2 text-3xl font-bold tracking-tight text-slate-900">{value}</p>
    </Card>
  );
}

function MemberSnapshot({
  rows,
}: {
  rows: Array<{ userId: string; name: string; total: number; count: number }>;
}) {
  if (rows.length === 0) {
    return <p className="mt-4 text-sm text-slate-500">No spending yet this month.</p>;
  }
  const max = Math.max(...rows.map((row) => row.total), 1);
  return (
    <ul className="mt-4 space-y-4">
      {rows.map((row) => (
        <li key={row.userId}>
          <div className="mb-1.5 flex items-center justify-between gap-3 text-sm">
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
        </li>
      ))}
    </ul>
  );
}

export default async function DashboardPage() {
  const auth = await requireHouseholdMember();
  const { user, householdId } = auth;
  const [summary, analytics] = await Promise.all([
    getDashboardSummary(householdId),
    getDashboardAnalytics(householdId),
  ]);

  const recentExpenses = summary.recentExpenses.slice(0, 5);
  const { total: monthTotal, count: monthCount } = analytics.thisMonth;
  const averageExpense = monthCount > 0 ? monthTotal / monthCount : 0;
  const canAdd = canCreateExpense(auth);

  return (
    <AppShell auth={auth}>
      <div className="space-y-8">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Hi, {user.name.split(" ")[0]}</h1>
            <p className="mt-1 text-sm text-slate-500">
              {auth.householdName} · {monthLabel()}
            </p>
          </div>
          {canAdd ? (
            <ButtonLink href="/expenses" className="w-full sm:w-auto">
              Add expense
            </ButtonLink>
          ) : null}
        </div>

        {/* Top summary — three calm cards */}
        <section className="grid gap-4 sm:grid-cols-3">
          <StatCard label="This month" value={formatCurrency(monthTotal)} />
          <StatCard label="Expenses" value={String(monthCount)} />
          <StatCard label="Average expense" value={formatCurrency(averageExpense)} />
        </section>

        {/* Recent expenses + member snapshot */}
        <section className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
          <Card className="p-6">
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-lg font-semibold text-slate-900">Recent expenses</h2>
              <Link className="text-sm font-medium text-brand-700 hover:text-brand-800" href="/expenses">
                View all
              </Link>
            </div>

            {recentExpenses.length === 0 ? (
              <div className="py-10 text-center">
                <p className="text-sm text-slate-500">No expenses yet.</p>
                {canAdd ? (
                  <Link className="mt-2 inline-block text-sm font-medium text-brand-700" href="/expenses">
                    Add your first expense
                  </Link>
                ) : null}
              </div>
            ) : (
              <ul className="mt-2 divide-y divide-slate-100">
                {recentExpenses.map((expense) => (
                  <li className="flex items-center justify-between gap-3 py-3" key={expense.id}>
                    <div className="min-w-0">
                      <Link
                        className="block truncate font-medium text-slate-900 hover:text-brand-700"
                        href={`/expenses/${expense.id}`}
                      >
                        {expense.category.name} · {expense.paidByUser.name}
                      </Link>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {expense.invoiceDate.toISOString().slice(0, 10)}
                      </p>
                    </div>
                    <div className="whitespace-nowrap text-right">
                      <p className="font-semibold text-slate-900">
                        {formatCurrency(expense.amount.toString())}
                      </p>
                      <Link
                        className="text-xs font-medium text-brand-700 hover:text-brand-800"
                        href={`/expenses/${expense.id}`}
                      >
                        View
                      </Link>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="p-6">
            <h2 className="text-lg font-semibold text-slate-900">Member snapshot</h2>
            <p className="text-xs text-slate-500">Spending this month, by member (paid by).</p>
            <MemberSnapshot rows={analytics.memberBreakdownThisMonth} />
          </Card>
        </section>

        {/* Quiet secondary links — hidden on mobile where the bottom nav already covers them */}
        <div className="hidden flex-wrap gap-3 sm:flex">
          <ButtonLink href="/reports" variant="secondary">Reports</ButtonLink>
          <ButtonLink href="/categories" variant="secondary">Categories</ButtonLink>
          <ButtonLink href="/household" variant="secondary">Household</ButtonLink>
        </div>
      </div>
    </AppShell>
  );
}
