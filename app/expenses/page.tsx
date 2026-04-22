import { AppShell } from "@/components/app-shell";
import { ExpenseForm } from "@/components/expense-form";
import { prisma } from "@/lib/db/prisma";
import { requireUser } from "@/lib/auth/session";
import { formatCurrency } from "@/lib/utils";

export default async function ExpensesPage() {
  const user = await requireUser();
  const categories = await prisma.category.findMany({
    where: { status: "ACTIVE" },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
    },
  });

  const recentExpenses = await prisma.expense.findMany({
    where: user.role === "ADMIN" ? {} : { userId: user.id },
    include: {
      category: true,
      user: true,
    },
    orderBy: {
      createdAt: "desc",
    },
    take: 8,
  });

  return (
    <AppShell user={user}>
      <div className="grid gap-6 xl:grid-cols-[1.1fr,0.9fr]">
        <ExpenseForm categories={categories} />

        <section className="rounded-3xl bg-white p-6 shadow-soft">
          <div className="mb-4">
            <h1 className="text-2xl font-semibold text-slate-900">Expense history</h1>
            <p className="text-sm text-slate-500">
              A simple recent list for the MVP. The API already supports fetching saved expenses.
            </p>
          </div>

          <div className="space-y-3">
            {recentExpenses.length === 0 ? (
              <p className="rounded-2xl bg-slate-50 px-4 py-6 text-sm text-slate-500">
                No saved expenses yet.
              </p>
            ) : (
              recentExpenses.map((expense) => (
                <div
                  className="rounded-2xl border border-slate-200 px-4 py-4"
                  key={expense.id}
                >
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="font-medium text-slate-900">{expense.invoiceNumber}</p>
                      <p className="text-sm text-slate-500">
                        {expense.category.name} • {expense.invoiceDate.toISOString().slice(0, 10)}
                        {user.role === "ADMIN" ? ` • ${expense.user.name}` : ""}
                      </p>
                    </div>

                    <div className="text-left sm:text-right">
                      <p className="text-lg font-semibold text-slate-900">
                        {formatCurrency(expense.amount.toString())}
                      </p>
                      <p className="text-xs text-slate-400">{expense.filePath}</p>
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
