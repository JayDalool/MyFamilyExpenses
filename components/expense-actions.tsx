"use client";

import type { FormEvent } from "react";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { useIsHydrated } from "@/lib/use-is-hydrated";

type CategoryOption = {
  id: string;
  name: string;
};

type EditableExpense = {
  id: string;
  categoryId: string;
  invoiceNumber: string;
  invoiceDate: string;
  amount: string;
};

type ExpenseActionsProps = {
  expense: EditableExpense;
  categories: CategoryOption[];
};

export function ExpenseActions({ expense, categories }: ExpenseActionsProps) {
  const router = useRouter();
  const isHydrated = useIsHydrated();
  const [isPending, startTransition] = useTransition();
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState(expense.categoryId);
  const [invoiceNumber, setInvoiceNumber] = useState(expense.invoiceNumber);
  const [invoiceDate, setInvoiceDate] = useState(expense.invoiceDate);
  const [amount, setAmount] = useState(expense.amount);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    startTransition(() => {
      void (async () => {
        setError(null);
        setSuccess(null);

        const response = await csrfFetch(`/api/expenses/${expense.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            categoryId,
            invoiceNumber,
            invoiceDate,
            amount: Number(amount),
          }),
        });

        const data = (await response.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;

        if (!response.ok) {
          setError(data?.error?.message ?? "Unable to update expense.");
          return;
        }

        setSuccess("Expense updated.");
        router.refresh();
      })();
    });
  };

  const handleDelete = async () => {
    if (!window.confirm("Delete this expense?")) {
      return;
    }

    setIsDeleting(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await csrfFetch(`/api/expenses/${expense.id}`, {
        method: "DELETE",
      });
      const data = (await response.json().catch(() => null)) as
        | { error?: { message?: string } }
        | null;

      if (!response.ok) {
        setError(data?.error?.message ?? "Unable to delete expense.");
        return;
      }

      router.push("/expenses");
      router.refresh();
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <section className="rounded-3xl bg-white p-6 shadow-soft">
      <h2 className="text-lg font-semibold text-slate-900">Correct expense</h2>

      <form className="mt-4 space-y-4" method="post" onSubmit={handleSubmit}>
        <div>
          <label className="mb-2 block text-sm font-medium text-slate-700" htmlFor="editCategory">
            Category
          </label>
          <select
            className="w-full rounded-2xl border border-slate-300 px-4 py-3 outline-none transition focus:border-brand-500"
            id="editCategory"
            onChange={(event) => setCategoryId(event.target.value)}
            required
            value={categoryId}
          >
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-2 block text-sm font-medium text-slate-700" htmlFor="editInvoiceNumber">
            Invoice number
          </label>
          <input
            className="w-full rounded-2xl border border-slate-300 px-4 py-3 outline-none transition focus:border-brand-500"
            id="editInvoiceNumber"
            maxLength={120}
            onChange={(event) => setInvoiceNumber(event.target.value)}
            required
            type="text"
            value={invoiceNumber}
          />
        </div>

        <div>
          <label className="mb-2 block text-sm font-medium text-slate-700" htmlFor="editInvoiceDate">
            Invoice date
          </label>
          <input
            className="w-full rounded-2xl border border-slate-300 px-4 py-3 outline-none transition focus:border-brand-500"
            id="editInvoiceDate"
            onChange={(event) => setInvoiceDate(event.target.value)}
            required
            type="date"
            value={invoiceDate}
          />
        </div>

        <div>
          <label className="mb-2 block text-sm font-medium text-slate-700" htmlFor="editAmount">
            Amount
          </label>
          <input
            className="w-full rounded-2xl border border-slate-300 px-4 py-3 outline-none transition focus:border-brand-500"
            id="editAmount"
            min="0"
            onChange={(event) => setAmount(event.target.value)}
            required
            step="0.01"
            type="number"
            value={amount}
          />
        </div>

        {error ? <p className="text-sm text-rose-600">{error}</p> : null}
        {success ? <p className="text-sm text-emerald-700">{success}</p> : null}

        <div className="flex flex-col gap-3 sm:flex-row">
          <button
            className="flex-1 rounded-2xl bg-brand-600 px-4 py-3 font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isPending || !isHydrated}
            type="submit"
          >
            {isPending ? "Saving..." : "Save changes"}
          </button>
          <button
            className="flex-1 rounded-2xl border border-rose-200 px-4 py-3 font-semibold text-rose-700 transition hover:border-rose-300 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isDeleting || !isHydrated}
            onClick={() => void handleDelete()}
            type="button"
          >
            {isDeleting ? "Deleting..." : "Delete expense"}
          </button>
        </div>
      </form>
    </section>
  );
}
