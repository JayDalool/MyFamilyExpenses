import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { prisma } from "@/lib/db/prisma";
import { requireUser } from "@/lib/auth/session";
import { formatCurrency, getStartOfMonth, getStartOfToday } from "@/lib/utils";

export default async function DashboardPage() {
  const user = await requireUser();
  const expenseScope = user.role === "ADMIN" ? {} : { userId: user.id };

  const [today, month, recentExpenses] = await Promise.all([
    prisma.expense.aggregate({
      where: { ...expenseScope, invoiceDate: { gte: getStartOfToday() } },
      _sum: { amount: true },
    }),
    prisma.expense.aggregate({
      where: { ...expenseScope, invoiceDate: { gte: getStartOfMonth() } },
      _sum: { amount: true },
    }),
    prisma.expense.findMany({
      where: expenseScope,
      include: { category: true, user: true },
      orderBy: { createdAt: "desc" },
      take: 6,
    }),
  ]);

  return (
    <AppShell user={user}>
      <div className="space-y-6">

        {/* Welcome + CTA */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">
              Hi, {user.name.split(" ")[0]}
            </h1>
            <p className="text-sm text-slate-500">Here is your spending summary.</p>
          </div>
          <Link
            href="/expenses"
            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-brand-600 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700 active:scale-95"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
            </svg>
            Add Expense
          </Link>
        </div>

        {/* Stat cards */}
        <section className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-3xl bg-white p-6 shadow-soft">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm font-medium text-slate-500">Today</p>
                <p className="mt-2 text-3xl font-bold text-slate-900">
                  {formatCurrency(today._sum.amount?.toString() ?? 0)}
                </p>
              </div>
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100">
                <svg className="h-5 w-5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </div>
            </div>
          </div>

          <div className="rounded-3xl bg-brand-600 p-6 text-white shadow-soft">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm font-medium text-brand-100">This month</p>
                <p className="mt-2 text-3xl font-bold text-white">
                  {formatCurrency(month._sum.amount?.toString() ?? 0)}
                </p>
              </div>
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-700">
                <svg className="h-5 w-5 text-brand-100" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
              </div>
            </div>
          </div>
        </section>

        {/* Recent expenses */}
        <section className="rounded-3xl bg-white p-6 shadow-soft">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Recent expenses</h2>
              <p className="text-sm text-slate-500">Latest saved invoices.</p>
            </div>
            <Link
              href="/expenses"
              className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-200"
            >
              View all
            </Link>
          </div>

          {recentExpenses.length === 0 ? (
            <div className="flex flex-col items-center gap-4 rounded-2xl bg-slate-50 px-4 py-10 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-200">
                <svg className="h-6 w-6 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z" />
                </svg>
              </div>
              <div>
                <p className="font-medium text-slate-700">No expenses yet</p>
                <p className="mt-1 text-sm text-slate-500">
                  Tap the button above to add your first invoice.
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-1">
              {recentExpenses.map((expense) => (
                <div
                  key={expense.id}
                  className="flex items-center justify-between rounded-2xl px-3 py-3 transition hover:bg-slate-50"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-brand-50">
                      <svg className="h-4 w-4 text-brand-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-slate-900">{expense.invoiceNumber}</p>
                      <p className="text-xs text-slate-400">
                        {expense.category.name}
                        {" · "}
                        {expense.invoiceDate.toISOString().slice(0, 10)}
                        {user.role === "ADMIN" ? ` · ${expense.user.name}` : ""}
                      </p>
                    </div>
                  </div>
                  <p className="text-sm font-semibold text-slate-900">
                    {formatCurrency(expense.amount.toString())}
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </AppShell>
  );
}
