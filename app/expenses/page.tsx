import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { ExpenseForm } from "@/components/expense-form";
import {
  listExpensesForUser,
  normalizeExpenseHistoryFilters,
} from "@/lib/expenses";
import { prisma } from "@/lib/db/prisma";
import { requireUser } from "@/lib/auth/session";
import { formatCurrency } from "@/lib/utils";

type ExpensesPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ExpensesPage({ searchParams }: ExpensesPageProps) {
  const user = await requireUser();
  const filters = normalizeExpenseHistoryFilters(
    ((await searchParams) ?? {}) as Record<string, string | string[] | undefined>,
  );

  const categories = await prisma.category.findMany({
    where: { status: "ACTIVE" },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
    },
  });

  const expenses = await listExpensesForUser(user, filters);
  const hasActiveFilters = Boolean(
    filters.invoiceNumber || filters.categoryId || filters.fromDate || filters.toDate,
  );

  return (
    <AppShell user={user}>
      <div className="grid gap-6 xl:grid-cols-[1.05fr,0.95fr]">
        <ExpenseForm categories={categories} />

        <section className="rounded-3xl bg-white p-6 shadow-soft">
          <div className="mb-6">
            <h1 className="text-2xl font-semibold text-slate-900">Expense history</h1>
            <p className="text-sm text-slate-500">
              Filter by invoice number, category, or date range and open any expense to preview or download the invoice.
            </p>
          </div>

          <form
            action="/expenses"
            className="mb-6 grid gap-3 rounded-2xl bg-slate-50 p-4 lg:grid-cols-2"
          >
            <div className="lg:col-span-2">
              <label className="mb-2 block text-sm font-medium text-slate-700" htmlFor="invoiceNumber">
                Invoice number
              </label>
              <input
                className="w-full rounded-2xl border border-slate-300 px-4 py-3 outline-none transition focus:border-brand-500"
                defaultValue={filters.invoiceNumber ?? ""}
                id="invoiceNumber"
                name="invoiceNumber"
                placeholder="INV-1001"
                type="text"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700" htmlFor="categoryId">
                Category
              </label>
              <select
                className="w-full rounded-2xl border border-slate-300 px-4 py-3 outline-none transition focus:border-brand-500"
                defaultValue={filters.categoryId ?? ""}
                id="categoryId"
                name="categoryId"
              >
                <option value="">All categories</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700" htmlFor="fromDate">
                  From date
                </label>
                <input
                  className="w-full rounded-2xl border border-slate-300 px-4 py-3 outline-none transition focus:border-brand-500"
                  defaultValue={filters.fromDate ?? ""}
                  id="fromDate"
                  name="fromDate"
                  type="date"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700" htmlFor="toDate">
                  To date
                </label>
                <input
                  className="w-full rounded-2xl border border-slate-300 px-4 py-3 outline-none transition focus:border-brand-500"
                  defaultValue={filters.toDate ?? ""}
                  id="toDate"
                  name="toDate"
                  type="date"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 lg:col-span-2">
              <button
                className="rounded-2xl bg-brand-600 px-4 py-3 font-semibold text-white transition hover:bg-brand-700"
                type="submit"
              >
                Apply filters
              </button>
              <Link
                className="rounded-2xl border border-slate-300 px-4 py-3 font-semibold text-slate-700 transition hover:border-slate-400 hover:text-slate-900"
                href="/expenses"
              >
                Reset
              </Link>
              <p className="text-sm text-slate-500">
                Showing {expenses.length} expense{expenses.length === 1 ? "" : "s"}
                {hasActiveFilters ? " with filters applied." : "."}
              </p>
            </div>
          </form>

          <div className="space-y-3">
            {expenses.length === 0 ? (
              <p className="rounded-2xl bg-slate-50 px-4 py-6 text-sm text-slate-500">
                {hasActiveFilters
                  ? "No expenses matched the current filters."
                  : "No saved expenses yet."}
              </p>
            ) : (
              expenses.map((expense) => (
                <div
                  className="rounded-2xl border border-slate-200 px-4 py-4"
                  key={expense.id}
                >
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
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

                    <div className="text-left sm:text-right">
                      <p className="text-lg font-semibold text-slate-900">
                        {formatCurrency(expense.amount.toString())}
                      </p>
                      <Link
                        className="text-sm font-medium text-brand-700 hover:text-brand-800"
                        href={`/expenses/${expense.id}`}
                      >
                        View details
                      </Link>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </AppShell>
  );
}
