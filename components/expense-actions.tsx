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

type MemberOption = {
  id: string;
  name: string;
};

type EditableExpense = {
  id: string;
  categoryId: string;
  invoiceNumber: string;
  invoiceDate: string;
  // Dollars, as typed into the number input. The API converts to cents.
  amount: string;
  tax: string;
  currency: string;
  vendor: string;
  paymentMethod: string;
  notes: string;
  isBusiness: boolean;
  vehicleLabel: string;
  odometerKm: string;
  paidByUserId: string;
};

const PAYMENT_METHOD_LABELS: Array<[string, string]> = [
  ["", "Not recorded"],
  ["CASH", "Cash"],
  ["DEBIT", "Debit"],
  ["CREDIT", "Credit"],
  ["ETRANSFER", "e-Transfer"],
  ["OTHER", "Other"],
];

type ExpenseActionsProps = {
  expense: EditableExpense;
  categories: CategoryOption[];
  members: MemberOption[];
  canAssignToOthers: boolean;
};

export function ExpenseActions({
  expense,
  categories,
  members,
  canAssignToOthers,
}: ExpenseActionsProps) {
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
  const [tax, setTax] = useState(expense.tax);
  const [currency, setCurrency] = useState(expense.currency);
  const [vendor, setVendor] = useState(expense.vendor);
  const [paymentMethod, setPaymentMethod] = useState(expense.paymentMethod);
  const [notes, setNotes] = useState(expense.notes);
  const [isBusiness, setIsBusiness] = useState(expense.isBusiness);
  const [vehicleLabel, setVehicleLabel] = useState(expense.vehicleLabel);
  const [odometerKm, setOdometerKm] = useState(expense.odometerKm);
  const [paidByUserId, setPaidByUserId] = useState(expense.paidByUserId);

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
            tax,
            currency,
            vendor,
            paymentMethod,
            notes,
            isBusiness,
            // PATCH replaces these, so they are always sent: leaving them out
            // would erase the vehicle on every unrelated edit.
            vehicleLabel,
            odometerKm,
            paidByUserId,
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

        <div>
          <label className="mb-2 block text-sm font-medium text-slate-700" htmlFor="editTax">
            Tax included in the total
          </label>
          <input
            className="w-full rounded-2xl border border-slate-300 px-4 py-3 outline-none transition focus:border-brand-500"
            id="editTax"
            min="0"
            onChange={(event) => setTax(event.target.value)}
            placeholder="Leave blank if the receipt does not say"
            step="0.01"
            type="number"
            value={tax}
          />
          <p className="mt-1 text-xs text-slate-500">
            The amount above is the total paid, tax included.
          </p>
        </div>

        <div>
          <label className="mb-2 block text-sm font-medium text-slate-700" htmlFor="editVendor">
            Vendor
          </label>
          <input
            className="w-full rounded-2xl border border-slate-300 px-4 py-3 outline-none transition focus:border-brand-500"
            id="editVendor"
            maxLength={120}
            onChange={(event) => setVendor(event.target.value)}
            type="text"
            value={vendor}
          />
        </div>

        <div>
          <label className="mb-2 block text-sm font-medium text-slate-700" htmlFor="editPaymentMethod">
            Payment method
          </label>
          <select
            className="w-full rounded-2xl border border-slate-300 px-4 py-3 outline-none transition focus:border-brand-500"
            id="editPaymentMethod"
            onChange={(event) => setPaymentMethod(event.target.value)}
            value={paymentMethod}
          >
            {PAYMENT_METHOD_LABELS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-2 block text-sm font-medium text-slate-700" htmlFor="editCurrency">
            Currency
          </label>
          <input
            className="w-full rounded-2xl border border-slate-300 px-4 py-3 outline-none transition focus:border-brand-500"
            id="editCurrency"
            maxLength={3}
            onChange={(event) => setCurrency(event.target.value.toUpperCase())}
            type="text"
            value={currency}
          />
        </div>

        <div>
          <label className="mb-2 block text-sm font-medium text-slate-700" htmlFor="editNotes">
            Notes
          </label>
          <textarea
            className="w-full rounded-2xl border border-slate-300 px-4 py-3 outline-none transition focus:border-brand-500"
            id="editNotes"
            maxLength={500}
            onChange={(event) => setNotes(event.target.value)}
            rows={3}
            value={notes}
          />
        </div>

        <div className="flex items-center gap-3">
          <input
            checked={isBusiness}
            className="h-5 w-5 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
            id="editIsBusiness"
            onChange={(event) => setIsBusiness(event.target.checked)}
            type="checkbox"
          />
          <label className="text-sm font-medium text-slate-700" htmlFor="editIsBusiness">
            Business expense
          </label>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700" htmlFor="editVehicle">
              Vehicle (optional)
            </label>
            <input
              className="w-full rounded-2xl border border-slate-300 px-4 py-3 outline-none transition focus:border-brand-500"
              id="editVehicle"
              maxLength={80}
              onChange={(event) => setVehicleLabel(event.target.value)}
              type="text"
              value={vehicleLabel}
            />
          </div>
          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700" htmlFor="editOdometer">
              Odometer (km)
            </label>
            <input
              className="w-full rounded-2xl border border-slate-300 px-4 py-3 outline-none transition focus:border-brand-500"
              id="editOdometer"
              inputMode="numeric"
              max={2000000}
              min={0}
              onChange={(event) => setOdometerKm(event.target.value)}
              step={1}
              type="number"
              value={odometerKm}
            />
          </div>
        </div>

        <div>
          <label className="mb-2 block text-sm font-medium text-slate-700" htmlFor="editPaidBy">
            Paid by / assigned member
          </label>
          <select
            className="w-full rounded-2xl border border-slate-300 px-4 py-3 outline-none transition focus:border-brand-500 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500"
            disabled={!canAssignToOthers}
            id="editPaidBy"
            onChange={(event) => setPaidByUserId(event.target.value)}
            value={paidByUserId}
          >
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
          </select>
          {!canAssignToOthers ? (
            <p className="mt-1 text-xs text-slate-400">
              Only an owner or admin can reassign which member an expense is attributed to.
            </p>
          ) : null}
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
