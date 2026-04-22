"use client";

import type { FormEvent } from "react";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type CategoryOption = {
  id: string;
  name: string;
};

type ExpenseFormProps = {
  categories: CategoryOption[];
};

export function ExpenseForm({ categories }: ExpenseFormProps) {
  const router = useRouter();
  const [selectedCategoryId, setSelectedCategoryId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);

    startTransition(() => {
      void (async () => {
        setError(null);
        setSuccess(null);

        const response = await fetch("/api/expenses", {
          method: "POST",
          body: formData,
        });

        const data = (await response.json().catch(() => null)) as
          | { data?: { expense?: { invoiceNumber?: string } }; error?: { message?: string } }
          | null;

        if (!response.ok) {
          setError(data?.error?.message ?? "Unable to save expense.");
          return;
        }

        form.reset();
        setSelectedCategoryId("");
        setSuccess(
          `Expense saved${data?.data?.expense?.invoiceNumber ? ` for ${data.data.expense.invoiceNumber}.` : "."}`,
        );
        router.refresh();
      })();
    });
  };

  return (
    <form
      className="space-y-4 rounded-3xl bg-white p-6 shadow-soft"
      onSubmit={handleSubmit}
    >
      <div>
        <label className="mb-2 block text-sm font-medium text-slate-700" htmlFor="categoryId">
          1. Select category
        </label>
        <select
          className="w-full rounded-2xl border border-slate-300 px-4 py-3 outline-none transition focus:border-brand-500"
          id="categoryId"
          name="categoryId"
          onChange={(event) => setSelectedCategoryId(event.target.value)}
          value={selectedCategoryId}
        >
          <option value="">Choose a category</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="mb-2 block text-sm font-medium text-slate-700" htmlFor="file">
          2. Upload invoice
        </label>
        <input
          accept=".pdf,image/png,image/jpeg,image/webp"
          className="block w-full rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-sm text-slate-600"
          disabled={!selectedCategoryId || isPending}
          id="file"
          name="file"
          type="file"
        />
        <p className="mt-2 text-xs text-slate-500">
          Choose a category first. Upload supports PDF, PNG, JPG, and WEBP.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label className="mb-2 block text-sm font-medium text-slate-700" htmlFor="invoiceNumber">
            Invoice number
          </label>
          <input
            className="w-full rounded-2xl border border-slate-300 px-4 py-3 outline-none transition focus:border-brand-500"
            id="invoiceNumber"
            name="invoiceNumber"
            placeholder="Leave blank for OCR mock"
            type="text"
          />
        </div>
        <div>
          <label className="mb-2 block text-sm font-medium text-slate-700" htmlFor="invoiceDate">
            Invoice date
          </label>
          <input
            className="w-full rounded-2xl border border-slate-300 px-4 py-3 outline-none transition focus:border-brand-500"
            id="invoiceDate"
            name="invoiceDate"
            type="date"
          />
        </div>
        <div>
          <label className="mb-2 block text-sm font-medium text-slate-700" htmlFor="amount">
            Amount
          </label>
          <input
            className="w-full rounded-2xl border border-slate-300 px-4 py-3 outline-none transition focus:border-brand-500"
            id="amount"
            min="0"
            name="amount"
            placeholder="24.99"
            step="0.01"
            type="number"
          />
        </div>
      </div>

      <p className="rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-600">
        3. Review and save. If you leave invoice details blank, the mock OCR service will fill in sample values for now.
      </p>

      {error ? <p className="text-sm text-rose-600">{error}</p> : null}
      {success ? <p className="text-sm text-emerald-700">{success}</p> : null}

      <button
        className="w-full rounded-2xl bg-brand-600 px-4 py-3 text-base font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
        disabled={isPending}
        type="submit"
      >
        {isPending ? "Saving expense..." : "Save expense"}
      </button>
    </form>
  );
}
