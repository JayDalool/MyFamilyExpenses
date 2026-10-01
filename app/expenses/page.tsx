import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { ExpenseWizard } from "@/components/expense-wizard";
import {
  listExpensesPageForUser,
  normalizeExpenseHistoryFilters,
} from "@/lib/expenses";
import { prisma } from "@/lib/db/prisma";
import { requireHouseholdMember } from "@/lib/auth/session";
import { formatCurrency } from "@/lib/utils";
import { canAssignExpenseToOthers, canCreateExpense } from "@/lib/auth/permissions";
import { HouseholdSwitcher } from "@/components/household-switcher";

type ExpensesPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function buildExpensesHref(
  filters: ReturnType<typeof normalizeExpenseHistoryFilters>,
  page: number,
) {
  const params = new URLSearchParams();

  if (filters.invoiceNumber) params.set("invoiceNumber", filters.invoiceNumber);
  if (filters.categoryId) params.set("categoryId", filters.categoryId);
  if (filters.fromDate) params.set("fromDate", filters.fromDate);
  if (filters.toDate) params.set("toDate", filters.toDate);
  if (filters.pageSize) params.set("pageSize", String(filters.pageSize));
  if (page > 1) params.set("page", String(page));

  const query = params.toString();
  return query ? `/expenses?${query}` : "/expenses";
}

export default async function ExpensesPage({ searchParams }: ExpensesPageProps) {
  const auth = await requireHouseholdMember();
  const { householdId } = auth;
  const filters = normalizeExpenseHistoryFilters(
    ((await searchParams) ?? {}) as Record<string, string | string[] | undefined>,
  );

  const [categories, memberships, expensePage] = await Promise.all([
    prisma.category.findMany({
      where: { householdId, status: "ACTIVE" },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true },
    }),
    prisma.membership.findMany({
      where: { householdId, removedAt: null },
      include: { user: { select: { id: true, name: true } } },
      orderBy: { createdAt: "asc" },
    }),
    listExpensesPageForUser(auth, filters),
  ]);
  const members = memberships.map((membership) => ({
    id: membership.user.id,
    name: membership.user.name,
  }));
  const { expenses, pagination } = expensePage;
  const hasActiveFilters = Boolean(
    filters.invoiceNumber || filters.categoryId || filters.fromDate || filters.toDate,
  );
  const canCreate = canCreateExpense(auth);

  return (
    <AppShell auth={auth}>
      <div className={`grid gap-6 ${canCreate ? "xl:grid-cols-[1fr,1fr]" : ""}`}>
        {canCreate ? <div>
          <div className="mb-4">
            <h1 className="text-2xl font-bold text-slate-900">Add Expense</h1>
            <p className="text-sm text-slate-500">
              Select a category, snap or upload your receipt, then save.
            </p>
          </div>
          <div className="mb-4 flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white p-4 shadow-soft sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Household</p>
              <p className="font-semibold text-slate-900">{auth.householdName}</p>
            </div>
            {auth.households.length > 1 ? (
              <div className="sm:text-right">
                <p className="mb-1 text-xs text-slate-500">Adding to a different household?</p>
                <HouseholdSwitcher
                  currentHouseholdId={auth.householdId}
                  households={auth.households}
                />
              </div>
            ) : null}
          </div>
          <ExpenseWizard
            categories={categories}
            members={members}
            currentUserId={auth.user.id}
            canAssignToOthers={canAssignExpenseToOthers(auth)}
          />
        </div> : null}

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
                Showing {expenses.length} of {pagination.total} expense{pagination.total === 1 ? "" : "s"}
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
                        {expense.category.name} | {expense.invoiceDate.toISOString().slice(0, 10)} | Paid by {expense.paidByUser.name}
                      </p>
                      <p className="text-xs text-slate-400">Entered by {expense.user.name}</p>
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

          {pagination.totalPages > 1 ? (
            <div className="mt-6 flex items-center justify-between gap-3 border-t border-slate-200 pt-4">
              <Link
                aria-disabled={pagination.page <= 1}
                className={`rounded-2xl border px-4 py-3 text-sm font-semibold transition ${
                  pagination.page <= 1
                    ? "pointer-events-none border-slate-200 text-slate-300"
                    : "border-slate-300 text-slate-700 hover:border-slate-400 hover:text-slate-900"
                }`}
                href={buildExpensesHref(filters, pagination.page - 1)}
              >
                Previous
              </Link>
              <p className="text-sm text-slate-500">
                Page {pagination.page} of {pagination.totalPages}
              </p>
              <Link
                aria-disabled={pagination.page >= pagination.totalPages}
                className={`rounded-2xl border px-4 py-3 text-sm font-semibold transition ${
                  pagination.page >= pagination.totalPages
                    ? "pointer-events-none border-slate-200 text-slate-300"
                    : "border-slate-300 text-slate-700 hover:border-slate-400 hover:text-slate-900"
                }`}
                href={buildExpensesHref(filters, pagination.page + 1)}
              >
                Next
              </Link>
            </div>
          ) : null}
        </section>
      </div>
    </AppShell>
  );
}
