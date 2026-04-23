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
      where: {
        ...expenseScope,
        invoiceDate: {
          gte: getStartOfToday(),
        },
      },
      _sum: {
        amount: true,
      },
    }),
    prisma.expense.aggregate({
      where: {
        ...expenseScope,
        invoiceDate: {
          gte: getStartOfMonth(),
        },
      },
      _sum: {
        amount: true,
      },
    }),
    prisma.expense.findMany({
      where: expenseScope,
      include: {
        category: true,
        user: true,
      },
      orderBy: {
        createdAt: "desc",
      },
      take: 6,
    }),
  ]);

  return (
    <AppShell user={user}>
      <div className="space-y-8">
        <section className="grid gap-4 md:grid-cols-3">
          <div className="rounded-3xl bg-white p-6 shadow-soft">
            <p className="text-sm font-medium text-slate-500">Total today</p>
            <p className="mt-3 text-3xl font-semibold text-slate-900">
              {formatCurrency(today._sum.amount?.toString() ?? 0)}
            </p>
          </div>

          <div className="rounded-3xl bg-white p-6 shadow-soft">
            <p className="text-sm font-medium text-slate-500">Total this month</p>
            <p className="mt-3 text-3xl font-semibold text-slate-900">
              {formatCurrency(month._sum.amount?.toString() ?? 0)}
            </p>
          </div>

          <div className="rounded-3xl bg-brand-600 p-6 text-white shadow-soft">
            <p className="text-sm font-medium text-brand-50">Quick start</p>
            <p className="mt-3 text-lg font-semibold">
              Select a category, upload an invoice, and save it in one short flow.
            </p>
          </div>
        </section>

        <section className="rounded-3xl bg-white p-6 shadow-soft">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold text-slate-900">Recent expenses</h2>
              <p className="text-sm text-slate-500">
                Latest saved invoices for this account scope.
              </p>
            </div>
          </div>

          <div className="space-y-3">
            {recentExpenses.length === 0 ? (
              <p className="rounded-2xl bg-slate-50 px-4 py-6 text-sm text-slate-500">
                No expenses yet. Add your first invoice from the Expenses screen.
              </p>
            ) : (
              recentExpenses.map((expense) => (
                <div
                  className="flex flex-col gap-2 rounded-2xl border border-slate-200 px-4 py-4 sm:flex-row sm:items-center sm:justify-between"
                  key={expense.id}
                >
                  <div>
                    <Link
                      className="font-medium text-slate-900 hover:text-brand-700"
                      href={`/expenses/${expense.id}`}
                    >
                      {expense.invoiceNumber}
                    </Link>
                    <p className="text-sm text-slate-500">
                      {expense.category.name} | {expense.invoiceDate.toISOString().slice(0, 10)}
                      {user.role === "ADMIN" ? ` | ${expense.user.name}` : ""}
                    </p>
                  </div>
                  <p className="text-lg font-semibold text-slate-900">
                    {formatCurrency(expense.amount.toString())}
                  </p>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </AppShell>
  );
}
